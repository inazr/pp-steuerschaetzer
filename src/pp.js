// Liest die steuerrelevanten Daten aus einer PP-Datei (XML oder Protobuf): Wertpapiere, Depots, Depotbuchungen, Ausschüttungen, Zinsen, Kurse.
// Beträge: Cent (÷100), Stücke: ÷1e8, Kurse: ÷1e8. Nur EUR-Wertpapiere und Buchungen in EUR werden berücksichtigt.
// Beide Leser erzeugen dasselbe Rohmodell; mapPortfolio wendet die gemeinsame Fachlogik an (EUR-Filter, Brutto, Warnungen, Reihenfolge).
//   securities: [{ uuid, name, isin, wkn, currency, prices: () => [[YYYY-MM-DD, Kurs]] }]
//   portfolios: [{ uuid, name, accountUuid, txs: [{ uuid, type, date, security, shares, amount, fees, taxes, transferKey? }] }]
//   accounts:   [{ uuid, name, currency, txs: [{ uuid, type: 'INTEREST' | 'DIVIDENDS', date, security, amount, fees, taxes }] }]
const PP_TX_TYPES = new Set(['BUY', 'SELL', 'DELIVERY_INBOUND', 'DELIVERY_OUTBOUND', 'TRANSFER_IN', 'TRANSFER_OUT']);
const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

function mapPortfolio(raw, warnings = []) {
  const eur = new Set(raw.securities.filter(s => s.currency === 'EUR').map(s => s.uuid));
  const used = new Set();
  // Buchung in Fremdwährung (z. B. EUR-Wertpapier über ein USD-Konto): Betrag ist nicht in EUR – auslassen, einmal je Wertpapier und Währung melden
  const secName = new Map(raw.securities.map(s => [s.uuid, s.name])), warnedCur = new Set();
  const foreign = tx => {
    const cur = tx.currency || 'EUR';
    if (cur === 'EUR') return false;
    const k = tx.security + '|' + cur;
    if (!warnedCur.has(k)) { warnedCur.add(k); warnings.push(`Buchungen in ${cur} ignoriert: ${secName.get(tx.security) || tx.security}`); }
    return true;
  };

  // Reihenfolge: Datum, dann Depot in der Depotliste, dann Quellreihenfolge (stabile Sortierung)
  const txs = [], seen = new Set();
  for (const p of raw.portfolios) {
    for (const tx of p.txs) {
      if (seen.has(tx.uuid) || !PP_TX_TYPES.has(tx.type)) continue;
      seen.add(tx.uuid);
      used.add(tx.security);
      if (!eur.has(tx.security) || foreign(tx)) continue;
      const t = {
        uuid: tx.uuid, date: tx.date, type: tx.type, depot: p.uuid, security: tx.security,
        shares: tx.shares, amount: tx.amount, fees: tx.fees, taxes: tx.taxes,
      };
      if (tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') t.transferKey = tx.transferKey;
      txs.push(t);
    }
  }
  txs.sort(byDate);

  const dividends = [], seenDiv = new Set(), accounts = [], interest = [], seenInt = new Set(), warnedInt = new Set();
  for (const a of raw.accounts) {
    const owners = raw.portfolios.filter(p => p.accountUuid === a.uuid);
    accounts.push({ uuid: a.uuid, name: a.name, currency: a.currency });
    for (const tx of a.txs) {
      if (tx.type === 'INTEREST') { // Brutto-Zinsen; INTEREST_CHARGE und negative Zinsen nie (§ 20 Abs. 9 EStG)
        if (seenInt.has(tx.uuid) || !(tx.amount > 0)) continue;
        seenInt.add(tx.uuid);
        if (a.currency !== 'EUR') { if (!warnedInt.has(a.uuid)) { warnedInt.add(a.uuid); warnings.push(`Zinsen in ${a.currency} ignoriert: ${a.name}`); } continue; }
        interest.push({ uuid: tx.uuid, date: tx.date, account: a.uuid, gross: tx.amount + tx.taxes });
        continue;
      }
      if (tx.type !== 'DIVIDENDS') continue;
      if (seenDiv.has(tx.uuid)) continue;
      seenDiv.add(tx.uuid);
      used.add(tx.security);
      if (!eur.has(tx.security) || foreign(tx)) continue;
      // Alle Depots am Konto; die Engine verteilt nach Bestand am Zahltag
      if (!owners.length) { warnings.push(`Ausschüttung ohne Depot ignoriert: ${tx.date}`); continue; }
      dividends.push({ uuid: tx.uuid, date: tx.date, depots: owners.map(p => p.uuid), security: tx.security, gross: tx.amount + tx.taxes + tx.fees });
    }
  }
  interest.sort(byDate);
  dividends.sort(byDate);

  for (const s of raw.securities) if (!eur.has(s.uuid) && used.has(s.uuid)) warnings.push('Nicht in EUR, ignoriert: ' + s.name);

  const prices = new Map();
  for (const s of raw.securities) {
    if (!eur.has(s.uuid)) continue;
    const list = s.prices().filter(([t, v]) => /^\d{4}-\d{2}-\d{2}$/.test(t) && Number.isFinite(v) && v > 0);
    list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    prices.set(s.uuid, list);
  }

  return {
    securities: raw.securities.filter(s => eur.has(s.uuid)).map(({ uuid, name, isin, wkn, currency }) => ({ uuid, name, isin, wkn, currency })),
    portfolios: raw.portfolios.map(({ uuid, name, accountUuid }) => ({ uuid, name, accountUuid })),
    txs, dividends, accounts, interest, prices, warnings,
  };
}

function extractPortfolio(xmlText) {
  const root = parseXml(xmlText);
  const day = s => s.slice(0, 10);
  const units = (tx, type) => kids(child(tx, 'units'), 'unit').filter(u => u.attrs.type === type)
    .reduce((s, u) => s + (+(child(u, 'amount')?.attrs.amount || 0)) / 100, 0);
  const secOf = tx => childText(child(tx, 'security'), 'uuid');
  const base = tx => ({
    uuid: childText(tx, 'uuid'), type: childText(tx, 'type'), date: day(childText(tx, 'date')), security: secOf(tx),
    amount: +childText(tx, 'amount') / 100, fees: units(tx, 'FEE'), taxes: units(tx, 'TAX'), currency: childText(tx, 'currencyCode') || 'EUR',
  });

  const securities = kids(child(root, 'securities'), 'security').map(s => ({
    uuid: childText(s, 'uuid'), name: childText(s, 'name'), isin: childText(s, 'isin'), wkn: childText(s, 'wkn'),
    currency: childText(s, 'currencyCode') || 'EUR',
    prices: () => kids(child(s, 'prices'), 'price').map(p => [p.attrs.t || '', +p.attrs.v / 1e8]),
  }));

  const portfolios = kids(child(root, 'portfolios'), 'portfolio').map(p => ({
    uuid: childText(p, 'uuid'), name: childText(p, 'name'), accountUuid: childText(child(p, 'referenceAccount'), 'uuid'),
    txs: kids(child(p, 'transactions'), 'portfolio-transaction').filter(tx => PP_TX_TYPES.has(childText(tx, 'type'))).map(tx => {
      const t = { ...base(tx), shares: +childText(tx, 'shares') / 1e8 };
      if (t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT') t.transferKey = childText(child(child(tx, 'crossEntry'), 'transactionFrom'), 'uuid');
      return t;
    }),
  }));

  const accounts = kids(child(root, 'accounts'), 'account').map(a => ({
    uuid: childText(a, 'uuid'), name: childText(a, 'name'), currency: childText(a, 'currencyCode') || 'EUR',
    txs: kids(child(a, 'transactions'), 'account-transaction').filter(tx => /^(INTEREST|DIVIDENDS)$/.test(childText(tx, 'type'))).map(base),
  }));

  return mapPortfolio({ securities, portfolios, accounts });
}

// Protobuf-Typen (PTransaction.type) → Depotbuchungstypen des XML-Formats
const PB_PORTFOLIO_TYPES = { 0: 'BUY', 1: 'SELL', 2: 'DELIVERY_INBOUND', 3: 'DELIVERY_OUTBOUND' };
const PB_SECURITY_TRANSFER = 4, PB_DIVIDEND = 8, PB_INTEREST = 9;
const PB_UNIT_TAX = 1, PB_UNIT_FEE = 2;

// bytes: Protobuf PClient ohne den Vorspann PPPBV1
function extractFromProtobuf(bytes) {
  const c = decodeClient(bytes);
  const warnings = [];
  // UTC-Tag; '' bei Werten außerhalb von Date oder ohne vierstelliges Jahr (Kurse fallen dann am Datumsfilter heraus)
  const day = seconds => {
    const d = new Date(seconds * 1000), s = isNaN(d) ? '' : d.toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  };
  const units = (tx, type) => tx.units.filter(u => u.type === type).reduce((s, u) => s + u.amount / 100, 0);

  const securities = c.securities.map(s => ({
    uuid: s.uuid, name: s.name, isin: s.isin, wkn: s.wkn, currency: s.currencyCode || 'EUR',
    prices: () => s.prices.map(([epochDay, close]) => [day(epochDay * 86400), close / 1e8]),
  }));
  const portfolios = c.portfolios.map(p => ({ uuid: p.uuid, name: p.name, accountUuid: p.referenceAccount, txs: [] }));
  const accounts = c.accounts.map(a => ({ uuid: a.uuid, name: a.name, currency: a.currencyCode || 'EUR', txs: [] }));
  const portfolioOf = new Map(portfolios.map(p => [p.uuid, p])), accountOf = new Map(accounts.map(a => [a.uuid, a]));

  let unknown = false, badDate = false;
  for (const tx of c.transactions) {
    const date = day(tx.seconds);
    const relevant = tx.type in PB_PORTFOLIO_TYPES || tx.type === PB_SECURITY_TRANSFER || tx.type === PB_DIVIDEND || tx.type === PB_INTEREST;
    if (relevant && !date) { badDate = true; continue; }
    const data = () => ({
      date, security: tx.security, shares: tx.shares / 1e8, amount: tx.amount / 100,
      fees: units(tx, PB_UNIT_FEE), taxes: units(tx, PB_UNIT_TAX), currency: tx.currencyCode || 'EUR',
    });
    if (tx.type in PB_PORTFOLIO_TYPES) {
      const p = portfolioOf.get(tx.portfolio);
      if (!p) { unknown = true; continue; }
      p.txs.push({ uuid: tx.uuid, type: PB_PORTFOLIO_TYPES[tx.type], ...data() });
    } else if (tx.type === PB_SECURITY_TRANSFER) {
      const from = portfolioOf.get(tx.portfolio), to = portfolioOf.get(tx.otherPortfolio);
      if (!from || !to) { unknown = true; continue; }
      from.txs.push({ uuid: tx.uuid, type: 'TRANSFER_OUT', ...data(), transferKey: tx.uuid });
      // Units gehören nur zur Quellbuchung (so lädt PP den Übertrag)
      to.txs.push({ uuid: tx.otherUuid, type: 'TRANSFER_IN', ...data(), fees: 0, taxes: 0, transferKey: tx.uuid });
    } else if (tx.type === PB_DIVIDEND || tx.type === PB_INTEREST) {
      const a = accountOf.get(tx.account);
      if (!a) { unknown = true; continue; }
      // Ausschüttung ohne Wertpapier gilt als Zins (wie PP beim Laden)
      a.txs.push({ uuid: tx.uuid, type: tx.type === PB_DIVIDEND && tx.security ? 'DIVIDENDS' : 'INTEREST', ...data() });
    } // INTEREST_CHARGE und übrige Typen: nicht steuerrelevant für dieses Tool
  }
  if (unknown) warnings.push('Buchung mit unbekanntem Depot/Konto ignoriert');
  if (badDate) warnings.push('Buchung mit ungültigem Datum ignoriert');

  return mapPortfolio({ securities, portfolios, accounts }, warnings);
}

// Datei (ArrayBuffer) → Datenstruktur, egal ob XML, binär oder verschlüsselt. password nur für verschlüsselte Dateien.
async function loadPortfolioData(buf, password) {
  const file = await readPortfolioFile(buf, password);
  try {
    return file.kind === 'protobuf' ? extractFromProtobuf(file.bytes) : extractPortfolio(file.text);
  } catch (e) {
    // Leserfehler (kaputtes XML, hängende Referenz, kaputtes Protobuf) einheitlich als „beschädigt“ melden
    if (/^(XML_BROKEN|BROKEN_REFERENCE|Protobuf:)/.test(String(e && e.message))) throw new Error('UNSUPPORTED_FORMAT');
    throw e;
  }
}
