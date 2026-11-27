import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeClient } from './pbwriter.mjs';

// Wandelt eine XPath-referenzierte PP-Datei in den XStream-id-Modus um (für den Gleichheitstest).
export function toIdMode(g, xml) {
  const root = g('parseXml')(xml), deref = g('deref');
  const ids = new Map(); let n = 0;
  const assign = node => { if (node.attrs.reference === undefined) { ids.set(node, String(++n)); node.children.forEach(assign); } };
  assign(root);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const out = node => {
    if (node.attrs.reference !== undefined) {
      const rest = Object.entries(node.attrs).filter(([k]) => k !== 'reference').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      return `<${node.name}${rest} reference="${ids.get(deref(node))}"/>`;
    }
    const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${node.name} id="${ids.get(node)}"${attrs}>${node.children.length ? node.children.map(out).join('') : esc(node.text)}</${node.name}>`;
  };
  return out(root);
}
const plain = d => JSON.parse(JSON.stringify({ ...d, prices: [...d.prices.entries()] }));

// Gleichheitstest XML ↔ Protobuf: eine Datenbeschreibung erzeugt beide Varianten.
const PB_TYPE = { BUY: 0, SELL: 1, DELIVERY_INBOUND: 2, TRANSFER: 4, DIVIDEND: 8, INTEREST: 9, INTEREST_CHARGE: 10 };
const PB_UNIT = { TAX: 1, FEE: 2 };
const SAME = {
  accounts: [{ uuid: 'acc-1', name: 'Verrechnung', cur: 'EUR' }, { uuid: 'acc-usd', name: 'USD-Konto', cur: 'USD' }],
  portfolios: [{ uuid: 'pf-A', name: 'Depot A', acc: 'acc-1' }, { uuid: 'pf-B', name: 'Depot B', acc: 'acc-1' }],
  securities: [
    { uuid: 'sec-eur', name: 'Euro ETF', cur: 'EUR', isin: 'IE00EQ000001', wkn: 'A1EQ01', prices: [['2023-01-02', 10012345678], ['2022-12-30', 9950000000]] },
    { uuid: 'sec-usd', name: 'US Corp', cur: 'USD', isin: 'US0000000001', prices: [['2023-01-02', 5000000000]] },
  ],
  // Quellreihenfolge im Protobuf: Einlieferung (Depot B) vor dem Kauf (Depot A) am selben Tag → kanonisch Depot A zuerst
  txs: [
    { type: 'DELIVERY_INBOUND', uuid: 'del-1', pf: 'pf-B', date: '2023-01-10', sec: 'sec-eur', shares: 500000000, amount: 55000 },
    { type: 'BUY', uuid: 'buy-1', pf: 'pf-A', acc: 'acc-1', date: '2023-01-10', sec: 'sec-eur', shares: 1000000000, amount: 100500, units: [['FEE', 500]] },
    { type: 'BUY', uuid: 'buy-usd', pf: 'pf-A', acc: 'acc-1', date: '2023-01-11', sec: 'sec-usd', shares: 200000000, amount: 20000 },
    { type: 'SELL', uuid: 'sell-1', pf: 'pf-A', acc: 'acc-1', date: '2023-06-01', sec: 'sec-eur', shares: 300000000, amount: 35000, units: [['TAX', 1234], ['FEE', 150]] },
    { type: 'TRANSFER', uuid: 'tr-out', otherUuid: 'tr-in', pf: 'pf-A', otherPf: 'pf-B', date: '2023-07-01', sec: 'sec-eur', shares: 400000000, amount: 44000, units: [['FEE', 300]] },
    { type: 'DIVIDEND', uuid: 'div-1', acc: 'acc-1', date: '2023-07-10', sec: 'sec-eur', amount: 1000, units: [['TAX', 264], ['FEE', 25]] },
    { type: 'DIVIDEND', uuid: 'div-nosec', acc: 'acc-1', date: '2023-08-01', amount: 500, units: [['TAX', 132]] },
    { type: 'INTEREST', uuid: 'int-1', acc: 'acc-1', date: '2023-09-30', amount: 7500, units: [['TAX', 2638]] },
    { type: 'INTEREST', uuid: 'int-usd', acc: 'acc-usd', date: '2023-09-30', amount: 300 },
    { type: 'INTEREST_CHARGE', uuid: 'chg-1', acc: 'acc-1', date: '2023-10-31', amount: 1200 },
  ],
};
const secs = d => Date.parse(d + 'T00:00:00Z') / 1000;
function sameAsXml(D) {
  const unitsXml = u => u ? `<units>${u.map(([t, a]) => `<unit type="${t}"><amount currency="EUR" amount="${a}"/></unit>`).join('')}</units>` : '';
  const ptx = (t, type, uuid, cross = '') => `<portfolio-transaction><uuid>${uuid}</uuid><date>${t.date}T00:00</date><currencyCode>EUR</currencyCode>`
    + `<amount>${t.amount}</amount><security><uuid>${t.sec}</uuid></security>${cross}<shares>${t.shares}</shares><type>${type}</type>${unitsXml(t.units)}</portfolio-transaction>`;
  const pfTxs = pf => D.txs.flatMap(t => {
    const cross = `<crossEntry class="portfolio-transfer"><transactionFrom><uuid>${t.uuid}</uuid></transactionFrom></crossEntry>`;
    if (t.type === 'TRANSFER') return [t.pf === pf ? ptx(t, 'TRANSFER_OUT', t.uuid, cross) : '', t.otherPf === pf ? ptx({ ...t, units: null }, 'TRANSFER_IN', t.otherUuid, cross) : '']; // PP: Units nur an der Quellbuchung
    return t.pf === pf ? [ptx(t, t.type, t.uuid)] : [];
  }).join('');
  const accTxs = acc => D.txs.filter(t => !t.pf && t.acc === acc).map(t => {
    const type = t.type === 'DIVIDEND' ? (t.sec ? 'DIVIDENDS' : 'INTEREST') : t.type; // PP: Ausschüttung ohne Wertpapier = Zins
    return `<account-transaction><uuid>${t.uuid}</uuid><date>${t.date}T00:00</date><currencyCode>EUR</currencyCode><amount>${t.amount}</amount>`
      + `${t.sec ? `<security><uuid>${t.sec}</uuid></security>` : ''}<type>${type}</type>${unitsXml(t.units)}</account-transaction>`;
  }).join('');
  return `<client><version>66</version><baseCurrency>EUR</baseCurrency><securities>${D.securities.map(s => `<security><uuid>${s.uuid}</uuid><name>${s.name}</name>`
    + `<currencyCode>${s.cur}</currencyCode><isin>${s.isin || ''}</isin><wkn>${s.wkn || ''}</wkn><prices>${s.prices.map(([t, v]) => `<price t="${t}" v="${v}"/>`).join('')}</prices></security>`).join('')}</securities>`
    + `<accounts>${D.accounts.map(a => `<account><uuid>${a.uuid}</uuid><name>${a.name}</name><currencyCode>${a.cur}</currencyCode><transactions>${accTxs(a.uuid)}</transactions></account>`).join('')}</accounts>`
    + `<portfolios>${D.portfolios.map(p => `<portfolio><uuid>${p.uuid}</uuid><name>${p.name}</name><referenceAccount><uuid>${p.acc}</uuid></referenceAccount><transactions>${pfTxs(p.uuid)}</transactions></portfolio>`).join('')}</portfolios></client>`;
}
const sameAsPb = D => encodeClient({
  version: 66, baseCurrency: 'EUR',
  securities: D.securities.map(s => ({ uuid: s.uuid, name: s.name, currencyCode: s.cur, isin: s.isin, wkn: s.wkn, prices: s.prices.map(([t, v]) => [secs(t) / 86400, v]) })),
  accounts: D.accounts.map(a => ({ uuid: a.uuid, name: a.name, currencyCode: a.cur })),
  portfolios: D.portfolios.map(p => ({ uuid: p.uuid, name: p.name, referenceAccount: p.acc })),
  transactions: D.txs.map(t => ({ type: PB_TYPE[t.type], uuid: t.uuid, account: t.acc, portfolio: t.pf, otherPortfolio: t.otherPf, otherUuid: t.otherUuid,
    seconds: secs(t.date), currencyCode: 'EUR', amount: t.amount, shares: t.shares, security: t.sec, units: (t.units || []).map(([u, a]) => ({ type: PB_UNIT[u], amount: a, currencyCode: 'EUR' })) })),
});
const byKey = (a, b) => (a.date + a.depot + a.type + a.uuid).localeCompare(b.date + b.depot + b.type + b.uuid);
const norm = d => JSON.stringify({ ...d, prices: [...d.prices.entries()], txs: [...d.txs].sort(byKey), dividends: [...d.dividends].sort(byKey), interest: [...d.interest].sort(byKey), warnings: [...d.warnings].sort() });

export default ({ g, check, near, root }) => {
  const extract = g('extractPortfolio');
  const fx = f => readFileSync(join(root, 'test/fixtures', f), 'utf8');

  const d = extract(fx('xpath.xml'));
  check('pp: one EUR security kept', d.securities.length === 1 && d.securities[0].uuid === 'sec-etf', d.securities);
  check('pp: security fields', d.securities[0].name === 'World ETF & Co' && d.securities[0].isin === 'IE00TEST0001' && !('wkn' in d.securities[0]), d.securities[0]);
  check('pp: non-EUR warning', d.warnings.includes('Nicht in EUR, ignoriert: US Stock'), d.warnings);
  check('pp: portfolio with account', d.portfolios.length === 1 && d.portfolios[0].uuid === 'pf-1' && d.portfolios[0].name === 'Depot A' && d.portfolios[0].accountUuid === 'acc-1', d.portfolios);
  check('pp: 3 EUR txs', d.txs.length === 3, d.txs.map(t => t.uuid));
  const byId = Object.fromEntries(d.txs.map(t => [t.uuid, t]));
  const b = byId['pt-buy1'];
  check('pp: buy decoded', b && b.type === 'BUY' && b.date === '2022-03-15' && b.depot === 'pf-1' && b.security === 'sec-etf'
    && b.shares === 10 && near(b.amount, 1005) && near(b.fees, 5) && b.taxes === 0, b);
  const s = byId['pt-sell1'];
  check('pp: sell decoded', s && s.type === 'SELL' && s.date === '2023-06-01' && s.shares === 2 && near(s.amount, 239) && near(s.fees, 1), s);
  check('pp: delivery inbound', byId['pt-del1'] && byId['pt-del1'].type === 'DELIVERY_INBOUND' && near(byId['pt-del1'].amount, 550));
  check('pp: dividend gross = net + tax', d.dividends.length === 1 && d.dividends[0].date === '2023-07-10' && d.dividends[0].depots.join() === 'pf-1'
    && d.dividends[0].security === 'sec-etf' && near(d.dividends[0].gross, 12.64), d.dividends);
  const pr = d.prices.get('sec-etf');
  check('pp: prices sorted and scaled', pr.length === 3 && pr[0][0] === '2022-12-30' && near(pr[0][1], 100) && near(pr[2][1], 130), pr);

  // id-Modus liefert dasselbe Ergebnis
  const idXml = toIdMode(g, fx('xpath.xml'));
  check('pp: id-mode fixture really uses ids', /^<client id="1">/.test(idXml) && /reference="\d+"/.test(idXml));
  check('pp: id-mode == xpath-mode', JSON.stringify(plain(extract(idXml))) === JSON.stringify(plain(d)));

  // Depotübertrag
  const t = extract(fx('transfer.xml'));
  check('pp: two depots', t.portfolios.map(p => p.uuid).join() === 'pf-A,pf-B' && t.portfolios[1].accountUuid === 'acc-1', t.portfolios);
  const out = t.txs.find(x => x.type === 'TRANSFER_OUT'), inn = t.txs.find(x => x.type === 'TRANSFER_IN');
  check('pp: transfer pair', out && inn && out.depot === 'pf-A' && inn.depot === 'pf-B' && out.transferKey === 'pt-out' && inn.transferKey === 'pt-out' && inn.shares === 4, { out, inn });

  // Laufzeit: 100.000 Kurse
  const prices = Array.from({ length: 100000 }, (_, k) => `<price t="${new Date(Date.UTC(1990, 0, 1) + k * 864e5).toISOString().slice(0, 10)}" v="${1e10 + k}"/>`).join('\n');
  const big = fx('xpath.xml').replace('<price t="2023-12-29" v="12000000000"/>', prices);
  const t0 = performance.now(); const bd = extract(big); const ms = performance.now() - t0;
  check('perf: 100k prices < 2000 ms', ms < 2000 && bd.prices.get('sec-etf').length === 100002, Math.round(ms));
  const ZX = `<client><securities/><accounts>
    <account><uuid>acc-1</uuid><name>Verrechnung</name><currencyCode>EUR</currencyCode><transactions>
      <account-transaction><uuid>z1</uuid><date>2026-03-31T00:00</date><amount>7500</amount><type>INTEREST</type>
        <units><unit type="TAX"><amount amount="2638"/></unit></units></account-transaction>
      <account-transaction><uuid>z2</uuid><date>2026-04-30T00:00</date><amount>1200</amount><type>INTEREST_CHARGE</type></account-transaction>
    </transactions></account>
    <account><uuid>acc-2</uuid><name>USD-Konto</name><currencyCode>USD</currencyCode><transactions>
      <account-transaction><uuid>z3</uuid><date>2026-03-31T00:00</date><amount>500</amount><type>INTEREST</type></account-transaction>
    </transactions></account></accounts>
    <portfolios><portfolio><uuid>pf-1</uuid><name>Depot</name><referenceAccount><uuid>acc-1</uuid></referenceAccount><transactions/></portfolio></portfolios></client>`;
  const zd = extract(ZX);
  check('pp: accounts listed', zd.accounts.length === 2 && zd.accounts[0].uuid === 'acc-1' && zd.accounts[1].currency === 'USD', zd.accounts);
  check('pp: interest gross = net + tax', zd.interest.length === 1 && zd.interest[0].account === 'acc-1' && near(zd.interest[0].gross, 101.38) && zd.interest[0].date === '2026-03-31', zd.interest);
  check('pp: INTEREST_CHARGE ignored', !zd.interest.some(i => i.uuid === 'z2'));
  check('pp: non-EUR interest warned', zd.warnings.some(w => w.includes('Zinsen in USD ignoriert') && w.includes('USD-Konto')), zd.warnings);
  // Minor 11: negative INTEREST (Negativzins) übersprungen; dieselbe UUID zählt einmal
  const ZN = `<client><securities/><accounts>
    <account><uuid>acc-1</uuid><name>Verrechnung</name><currencyCode>EUR</currencyCode><transactions>
      <account-transaction><uuid>n1</uuid><date>2026-01-31T00:00</date><amount>-500</amount><type>INTEREST</type></account-transaction>
      <account-transaction><uuid>d1</uuid><date>2026-02-28T00:00</date><amount>1000</amount><type>INTEREST</type></account-transaction>
      <account-transaction><uuid>d1</uuid><date>2026-02-28T00:00</date><amount>1000</amount><type>INTEREST</type></account-transaction>
    </transactions></account></accounts>
    <portfolios><portfolio><uuid>pf-1</uuid><name>Depot</name><referenceAccount><uuid>acc-1</uuid></referenceAccount><transactions/></portfolio></portfolios></client>`;
  const zn = extract(ZN);
  check('pp minor 11: negative INTEREST skipped', !zn.interest.some(i => i.uuid === 'n1' || i.gross < 0), zn.interest);
  check('pp minor 11: interest deduped per UUID', zn.interest.length === 1 && zn.interest[0].uuid === 'd1' && near(zn.interest[0].gross, 10), zn.interest);

  // Protobuf liefert dieselbe Datenstruktur wie der XML-Leser
  const xmlText = sameAsXml(SAME), pbBytes = sameAsPb(SAME);
  const fromPb = g('extractFromProtobuf')(pbBytes), fromXml = extract(xmlText);
  check('pb: xml fixture is meaningful', fromXml.txs.length === 5 && fromXml.dividends.length === 1 && fromXml.interest.length === 2
    && fromXml.warnings.length === 2, { txs: fromXml.txs.map(t => t.uuid), warnings: fromXml.warnings });
  check('pb: protobuf == xml', norm(fromPb) === norm(fromXml), { pb: norm(fromPb), xml: norm(fromXml) });
  check('pb: canonical order on ties (date, depot index, source order)', fromPb.txs.map(t => t.uuid).join() === fromXml.txs.map(t => t.uuid).join(), fromPb.txs.map(t => t.uuid));
  check('pb: dividend without security becomes interest', fromPb.interest.some(i => i.uuid === 'div-nosec'));
  check('pb: transfer pair keyed by source uuid', fromPb.txs.some(t => t.uuid === 'tr-in' && t.type === 'TRANSFER_IN' && t.depot === 'pf-B' && t.transferKey === 'tr-out'));
  const unknownCase = transactions => g('extractFromProtobuf')(encodeClient({ securities: [{ uuid: 'sec-eur', name: 'ETF', currencyCode: 'EUR' }],
    portfolios: [{ uuid: 'pf-A', name: 'A', referenceAccount: 'acc-1' }], accounts: [{ uuid: 'acc-1', name: 'K', currencyCode: 'EUR' }], transactions }));
  const unknownWarned = d => d.warnings.some(w => w.includes('unbekanntem Depot')) && !d.txs.length && !d.dividends.length && !d.interest.length;
  const pbUnknown = unknownCase([{ uuid: 'x1', portfolio: 'pf-X', account: 'acc-1', seconds: secs('2023-01-02'), amount: 100, shares: 100000000, security: 'sec-eur' }]);
  check('pb: unknown portfolio warned', unknownWarned(pbUnknown), pbUnknown);
  const du = unknownCase([{ uuid: 'x2', type: 9, account: 'acc-X', seconds: secs('2023-01-02'), amount: 100 }]);
  check('pb: unknown account warned', unknownWarned(du), du);
  const dt = unknownCase([{ uuid: 'x3', type: 4, portfolio: 'pf-A', otherPortfolio: 'pf-X', otherUuid: 'x3-in', seconds: secs('2023-01-02'), amount: 100, shares: 100000000, security: 'sec-eur' }]);
  check('pb: transfer to unknown portfolio warned, both halves dropped', unknownWarned(dt), dt);
  // Datum außerhalb des gültigen Bereichs: Kurs verworfen, Buchung mit Warnung übersprungen, Rest geladen
  const huge = 9e15; // Sekunden → kein gültiges Date
  const badDate = g('extractFromProtobuf')(encodeClient({
    securities: [{ uuid: 'sec-eur', name: 'ETF', currencyCode: 'EUR', prices: [[19000, 1e10], [huge, 1e10], [3e6, 1e10]] }],
    portfolios: [{ uuid: 'pf-A', name: 'A', referenceAccount: 'acc-1' }], accounts: [{ uuid: 'acc-1', name: 'K', currencyCode: 'EUR' }],
    transactions: [
      { uuid: 'ok', portfolio: 'pf-A', account: 'acc-1', seconds: secs('2023-01-02'), amount: 100, shares: 100000000, security: 'sec-eur' },
      { uuid: 'bad', portfolio: 'pf-A', account: 'acc-1', seconds: huge, amount: 100, shares: 100000000, security: 'sec-eur' },
      { uuid: 'far', portfolio: 'pf-A', account: 'acc-1', seconds: 3e6 * 86400, amount: 100, shares: 100000000, security: 'sec-eur' },
      { uuid: 'bad-div', type: 8, account: 'acc-1', seconds: -huge, amount: 100, security: 'sec-eur' },
    ] }));
  check('pb: invalid date tx skipped with warning', badDate.txs.map(t => t.uuid).join() === 'ok' && !badDate.dividends.length
    && badDate.warnings.filter(w => w === 'Buchung mit ungültigem Datum ignoriert').length === 1, badDate);
  const badPrices = badDate.prices.get('sec-eur');
  check('pb: invalid price dates dropped', badPrices.length === 1 && badPrices[0][0] === '2022-01-08', badPrices);

  // B3: EUR-Wertpapier über USD-Konto – Buchungen in Fremdwährung werden ausgelassen und gemeldet
  const usd = `<client><securities><security><uuid>s1</uuid><name>ETF UCITS</name><currencyCode>EUR</currencyCode><isin>IE1</isin><prices/></security></securities>
<accounts><account><uuid>a1</uuid><name>USD</name><currencyCode>USD</currencyCode><transactions>
<account-transaction><uuid>x1</uuid><date>2026-03-01T00:00</date><currencyCode>USD</currencyCode><amount>50000</amount><security reference="../../../../../securities/security"/><shares>0</shares><type>DIVIDENDS</type></account-transaction>
</transactions></account></accounts>
<portfolios><portfolio><uuid>p1</uuid><name>Depot</name><referenceAccount reference="../../../accounts/account"/><transactions>
<portfolio-transaction><uuid>t1</uuid><date>2026-01-10T00:00</date><currencyCode>USD</currencyCode><amount>1100000</amount><security reference="../../../../../securities/security"/><shares>10000000000</shares><type>BUY</type></portfolio-transaction>
<portfolio-transaction><uuid>t2</uuid><date>2026-01-11T00:00</date><currencyCode>EUR</currencyCode><amount>100000</amount><security reference="../../../../../securities/security"/><shares>1000000000</shares><type>BUY</type></portfolio-transaction>
<portfolio-transaction><uuid>t3</uuid><date>2026-01-12T00:00</date><amount>100000</amount><security reference="../../../../../securities/security"/><shares>1000000000</shares><type>BUY</type></portfolio-transaction>
</transactions></portfolio></portfolios></client>`;
  const pu = g('extractPortfolio')(usd);
  check('B3 xml: USD buy and dividend skipped, EUR buys kept (missing currency = EUR)', pu.txs.length === 2 && pu.txs[0].amount === 1000 && pu.dividends.length === 0, [pu.txs, pu.dividends]);
  const W_DEP = 'Depotbuchungen in USD ignoriert: ETF UCITS – Bestand und Steuerwerte dieses Wertpapiers sind unvollständig', W_DIV = 'Ausschüttungen in USD ignoriert: ETF UCITS';
  check('B3 xml: one warning per security, currency and kind', pu.warnings.filter(w => w === W_DEP).length === 1 && pu.warnings.filter(w => w === W_DIV).length === 1 && pu.warnings.length === 2, pu.warnings);
  // Schlussprüfung I1: EUR-Kauf, Verkauf in USD – der Bestand bleibt stehen, das muss die Meldung sagen
  const pSell = g('extractPortfolio')(usd.replace('<currencyCode>USD</currencyCode><amount>1100000</amount>', '<currencyCode>EUR</currencyCode><amount>1100000</amount>').replace('<uuid>t3</uuid><date>2026-01-12T00:00</date>', '<uuid>t3</uuid><date>2026-01-12T00:00</date><currencyCode>USD</currencyCode>').replace('<type>BUY</type></portfolio-transaction>\n</transactions>', '<type>SELL</type></portfolio-transaction>\n</transactions>'));
  check('I1: skipped foreign-currency sell says the holding is incomplete', pSell.txs.every(t => t.type === 'BUY') && pSell.warnings.includes(W_DEP), [pSell.txs.map(t => t.type), pSell.warnings]);
  const sec26 = Date.UTC(2026, 0, 10) / 1000;
  const pbu = g('extractFromProtobuf')(encodeClient({
    securities: [{ uuid: 's1', name: 'ETF UCITS', currencyCode: 'EUR', isin: 'IE1' }], accounts: [{ uuid: 'a1', name: 'USD', currencyCode: 'USD' }],
    portfolios: [{ uuid: 'p1', name: 'Depot', referenceAccount: 'a1' }],
    transactions: [
      { uuid: 't1', type: 0, portfolio: 'p1', account: 'a1', seconds: sec26, currencyCode: 'USD', amount: 1100000, shares: 10000000000, security: 's1' },
      { uuid: 't2', type: 0, portfolio: 'p1', account: 'a1', seconds: sec26, currencyCode: 'EUR', amount: 100000, shares: 1000000000, security: 's1' },
      { uuid: 'x1', type: 8, account: 'a1', seconds: sec26, currencyCode: 'USD', amount: 50000, security: 's1' },
    ] }));
  check('B3 protobuf: USD buy and dividend skipped, EUR buy kept', pbu.txs.length === 1 && pbu.txs[0].amount === 1000 && pbu.dividends.length === 0, [pbu.txs, pbu.dividends]);
  check('B3 protobuf: same warnings', pbu.warnings.filter(w => w === W_DEP).length === 1 && pbu.warnings.filter(w => w === W_DIV).length === 1, pbu.warnings);
};
