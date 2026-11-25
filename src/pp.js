// Liest die steuerrelevanten Daten aus einer PP-XML: Wertpapiere, Depots, Depotbuchungen, Ausschüttungen, Kurse.
// Beträge: Cent (÷100), Stücke: ÷1e8, Kurse: ÷1e8. Nur EUR-Wertpapiere werden berücksichtigt.
const PP_TX_TYPES = new Set(['BUY', 'SELL', 'DELIVERY_INBOUND', 'DELIVERY_OUTBOUND', 'TRANSFER_IN', 'TRANSFER_OUT']);

function extractPortfolio(xmlText) {
  const root = parseXml(xmlText);
  const warnings = [];
  const day = s => s.slice(0, 10);
  const units = (tx, type) => kids(child(tx, 'units'), 'unit').filter(u => u.attrs.type === type)
    .reduce((s, u) => s + (+(child(u, 'amount')?.attrs.amount || 0)) / 100, 0);
  const secOf = tx => childText(child(tx, 'security'), 'uuid');

  const allSecs = kids(child(root, 'securities'), 'security').map(s => ({
    uuid: childText(s, 'uuid'), name: childText(s, 'name'), isin: childText(s, 'isin'), wkn: childText(s, 'wkn'),
    currency: childText(s, 'currencyCode') || 'EUR', node: s,
  }));
  const eur = new Set(allSecs.filter(s => s.currency === 'EUR').map(s => s.uuid));
  const used = new Set();

  const portfolios = kids(child(root, 'portfolios'), 'portfolio').map(p => ({
    uuid: childText(p, 'uuid'), name: childText(p, 'name'), accountUuid: childText(child(p, 'referenceAccount'), 'uuid'), node: p,
  }));

  const txs = [], seen = new Set();
  for (const p of portfolios) {
    for (const tx of kids(child(p.node, 'transactions'), 'portfolio-transaction')) {
      const uuid = childText(tx, 'uuid'), type = childText(tx, 'type');
      if (seen.has(uuid) || !PP_TX_TYPES.has(type)) continue;
      seen.add(uuid);
      const security = secOf(tx);
      used.add(security);
      if (!eur.has(security)) continue;
      const t = {
        uuid, date: day(childText(tx, 'date')), type, depot: p.uuid, security,
        shares: +childText(tx, 'shares') / 1e8, amount: +childText(tx, 'amount') / 100,
        fees: units(tx, 'FEE'), taxes: units(tx, 'TAX'),
      };
      if (type === 'TRANSFER_IN' || type === 'TRANSFER_OUT') t.transferKey = childText(child(child(tx, 'crossEntry'), 'transactionFrom'), 'uuid');
      txs.push(t);
    }
  }
  txs.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  const dividends = [], seenDiv = new Set();
  for (const a of kids(child(root, 'accounts'), 'account')) {
    const accUuid = childText(a, 'uuid');
    const owners = portfolios.filter(p => p.accountUuid === accUuid);
    for (const tx of kids(child(a, 'transactions'), 'account-transaction')) {
      if (childText(tx, 'type') !== 'DIVIDENDS') continue;
      const uuid = childText(tx, 'uuid');
      if (seenDiv.has(uuid)) continue;
      seenDiv.add(uuid);
      const security = secOf(tx);
      used.add(security);
      if (!eur.has(security)) continue;
      const date = day(childText(tx, 'date'));
      // Alle Depots am Konto; die Engine verteilt nach Bestand am Zahltag
      if (!owners.length) { warnings.push(`Ausschüttung ohne Depot ignoriert: ${date}`); continue; }
      dividends.push({ uuid, date, depots: owners.map(p => p.uuid), security, gross: +childText(tx, 'amount') / 100 + units(tx, 'TAX') + units(tx, 'FEE') });
    }
  }
  dividends.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  for (const s of allSecs) if (!eur.has(s.uuid) && used.has(s.uuid)) warnings.push('Nicht in EUR, ignoriert: ' + s.name);

  const prices = new Map();
  for (const s of allSecs) {
    if (!eur.has(s.uuid)) continue;
    const list = kids(child(s.node, 'prices'), 'price').map(p => [p.attrs.t || '', +p.attrs.v / 1e8])
      .filter(([t, v]) => /^\d{4}-\d{2}-\d{2}$/.test(t) && Number.isFinite(v) && v > 0);
    list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    prices.set(s.uuid, list);
  }

  return {
    securities: allSecs.filter(s => eur.has(s.uuid)).map(({ node, ...s }) => s),
    portfolios: portfolios.map(({ node, ...p }) => p),
    txs, dividends, prices, warnings,
  };
}
