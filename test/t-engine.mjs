// Testdaten direkt als Data-Objekt (Format aus extractPortfolio)
let n = 0;
const tx = (date, type, depot, shares, amount, extra = {}) => ({ uuid: 't' + (++n), date, type, depot, security: 'S', shares, amount, fees: 0, taxes: 0, ...extra });
const mk = ({ txs, dividends = [], prices, secs }) => ({
  securities: secs || [{ uuid: 'S', name: 'ETF', isin: 'IS', wkn: '', currency: 'EUR' }],
  portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'k' }, { uuid: 'B', name: 'Depot B', accountUuid: 'k' }],
  txs, dividends, prices: new Map([['S', prices]]), warnings: [],
});
const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: null, fundTypes: {}, depots: null };

export default ({ g, check, near }) => {
  const vpForLot = g('vpForLot'), replay = g('replay');

  // Formel § 18 InvStG
  let r = vpForLot({ wertAnfang: 10000, wertEnde: 12000, basiszins: 0.0255, ausschuettungen: 0, kaufdatum: '2020-01-01', jahr: 2023 });
  check('vp golden: basisertrag 178.50', near(r.basisertrag, 178.5, 1e-9), r);
  check('vp golden: vp 178.50', near(r.vp, 178.5, 1e-9), r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 10100, basiszins: 0.0255, ausschuettungen: 0, kaufdatum: '2020-01-01', jahr: 2023 });
  check('vp capped by gain', near(r.vp, 100, 1e-9), r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 10100, basiszins: 0.0255, ausschuettungen: 50, kaufdatum: '2020-01-01', jahr: 2023 });
  check('vp cap = gain + distributions (§18 Abs.1 S.3)', near(r.vp, 100, 1e-9), r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 12000, basiszins: 0.0255, ausschuettungen: 200, kaufdatum: '2020-01-01', jahr: 2023 });
  check('vp: distributions above basisertrag -> 0', r.vp === 0, r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 12000, basiszins: -0.0045, ausschuettungen: 0, kaufdatum: '2020-01-01', jahr: 2021 });
  check('vp negative basiszins', r.vp === 0 && r.basisertrag === 0, r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 9000, basiszins: 0.0255, ausschuettungen: 0, kaufdatum: '2020-01-01', jahr: 2023 });
  check('vp: loss year -> 0', r.vp === 0, r);
  r = vpForLot({ wertAnfang: 10000, wertEnde: 12000, basiszins: 0.0255, ausschuettungen: 0, kaufdatum: '2023-03-20', jahr: 2023 });
  check('vp pro rata: March -> 10/12', near(r.vp, 148.75, 1e-9), r);

  // Ende-zu-Ende: Jahr 2023, 100 Stück, 100 -> 120
  const P = [['2022-12-30', 100], ['2023-12-29', 120], ['2024-04-30', 125]];
  let res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 9500)], prices: P }), SET, '2024-05-01');
  const row23 = res.vpRows.find(x => x.year === 2023);
  check('replay golden: VP row 2023', row23 && near(row23.vp, 178.5, 1e-9) && near(row23.taxable, 124.95, 1e-9) && near(row23.tax, 32.96, 1e-9), row23);
  check('replay golden: row fields', row23 && row23.depot === 'A' && row23.security === 'S' && near(row23.wertAnfang, 10000) && near(row23.wertEnde, 12000) && row23.tfs === 0.3, row23);
  check('replay golden: lot vpCum', res.lots.length === 1 && near(res.lots[0].vpCum, 178.5, 1e-9) && near(res.lots[0].cost, 95), res.lots);
  check('replay: latest price', res.latest.get('S')[0] === '2024-04-30' && res.latest.get('S')[1] === 125);
  check('replay: no errors', res.errors.length === 0, res.errors);

  // Einzelaktie: keine VP
  res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 9500)], prices: P }), { ...SET, fundTypes: { IS: 'einzelaktie' } }, '2024-05-01');
  check('einzelaktie: no VP', res.vpRows.length === 0 && res.lots[0].vpCum === 0, res.vpRows);

  // FIFO-Verkauf teilt Lot und VP anteilig
  res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2023-02-01', 'BUY', 'A', 50, 5500), tx('2024-02-01', 'SELL', 'A', 120, 14400)], prices: P }), SET, '2024-05-01');
  check('fifo: remaining 30 from 2nd lot', res.lots.length === 1 && near(res.lots[0].shares, 30, 1e-9) && res.lots[0].buyDate === '2023-02-01', res.lots);
  const vpLot2 = vpForLot({ wertAnfang: 5000, wertEnde: 6000, basiszins: 0.0255, ausschuettungen: 0, kaufdatum: '2023-02-01', jahr: 2023 }).vp;
  check('fifo: vpCum split proportionally', near(res.lots[0].vpCum, vpLot2 * 30 / 50, 1e-6), [res.lots[0].vpCum, vpLot2]);
  check('fifo: realized taxable gain recorded', near(res.realized[2024], ((120 - 100 - 178.5 / 100) * 100 + (120 - 110 - vpLot2 / 50) * 20) * 0.7, 0.01), res.realized);

  // Überverkauf -> Fehler, kein Absturz
  res = replay(mk({ txs: [tx('2023-01-10', 'BUY', 'A', 10, 1000), tx('2023-02-01', 'SELL', 'A', 15, 1500)], prices: P }), SET, '2024-05-01');
  check('oversell: one error with date', res.errors.length === 1 && res.errors[0].includes('01.02.2023'), res.errors);
  check('oversell: queue empty', res.lots.length === 0);

  // Depotübertrag: Lots wandern mit Kaufdatum und Einstand, Ziel-Queue nach Kaufdatum sortiert
  res = replay(mk({ txs: [
    tx('2020-02-03', 'BUY', 'A', 10, 1000), tx('2020-05-04', 'BUY', 'A', 5, 600), tx('2020-03-02', 'BUY', 'B', 1, 90),
    tx('2021-01-04', 'TRANSFER_OUT', 'A', 12, 1440, { transferKey: 'x' }), tx('2021-01-04', 'TRANSFER_IN', 'B', 12, 1440, { transferKey: 'x' }),
  ], prices: [] }), SET, '2021-06-01');
  const lotsB = res.lots.filter(l => l.depot === 'B').map(l => [l.buyDate, +l.shares.toFixed(8), l.cost]);
  const lotsA = res.lots.filter(l => l.depot === 'A').map(l => [l.buyDate, +l.shares.toFixed(8), l.cost]);
  check('transfer: target lots keep date/cost, FIFO order', JSON.stringify(lotsB) === JSON.stringify([['2020-02-03', 10, 100], ['2020-03-02', 1, 90], ['2020-05-04', 2, 120]]), lotsB);
  check('transfer: source keeps rest', JSON.stringify(lotsA) === JSON.stringify([['2020-05-04', 3, 120]]), lotsA);
  check('transfer: no errors (price gaps are warnings)', res.errors.length === 0, res.errors);

  // Ausschüttungen: brutto je Stück im Depot am Zahltag, nur für Lots dieses Depots
  const P2 = [['2022-12-30', 100], ['2023-12-29', 101], ['2024-04-30', 101]];
  res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2022-12-01', 'BUY', 'B', 100, 10000)],
    dividends: [{ uuid: 'd1', date: '2023-06-15', depot: 'A', security: 'S', gross: 50 }], prices: P2 }), SET, '2024-05-01');
  const ra = res.vpRows.find(x => x.year === 2023 && x.depot === 'A'), rb = res.vpRows.find(x => x.year === 2023 && x.depot === 'B');
  check('dividends: depot A reduced (cap 100+50, minus 50)', ra && near(ra.ausschuettungen, 50) && near(ra.vp, 100, 1e-9), ra);
  check('dividends: depot B unaffected', rb && near(rb.ausschuettungen, 0) && near(rb.vp, 100, 1e-9), rb);

  // Depotfilter: nur Ausgabe gefiltert, FIFO läuft über alle Depots
  res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2022-12-01', 'BUY', 'B', 7, 700)], prices: P }), { ...SET, depots: ['B'] }, '2024-05-01');
  check('depot filter: only B in output', res.lots.length === 1 && res.lots[0].depot === 'B' && res.vpRows.every(x => x.depot === 'B'), res.lots);

  // Review Focus: Neukauf nach Komplettverkauf
  const P3 = [['2018-12-28', 100], ['2019-12-30', 110], ['2020-12-30', 120], ['2021-12-30', 130]];
  const rebuy = mk({ txs: [tx('2018-12-03', 'BUY', 'A', 10, 1000), tx('2021-03-01', 'SELL', 'A', 10, 1250), tx('2021-06-01', 'BUY', 'A', 5, 625)], prices: P3 });
  res = replay(rebuy, SET, '2021-12-01');
  check('rebuy after full sale: new lot starts clean', res.lots.length === 1 && res.lots[0].vpCum === 0 && res.lots[0].buyDate === '2021-06-01', res.lots);
  res = replay(rebuy, SET, '2022-02-01');
  check('rebuy: 2021 negative Basiszins -> still 0', res.lots[0].vpCum === 0, res.lots);

  // Review Focus: fehlender Kurs zum Jahresanfang -> übersprungen mit Hinweis, kein NaN
  res = replay(mk({ txs: [tx('2023-05-10', 'BUY', 'A', 10, 1000)], prices: [['2023-05-10', 100], ['2023-12-29', 110]] }), SET, '2024-03-01');
  check('missing start price: no VP row, warning', res.vpRows.length === 0 && res.warnings.some(w => w.includes('Kein Kurs')), res.warnings);
  check('missing start price: vpCum is 0 not NaN', res.lots[0].vpCum === 0);

  // Heuristik in der Engine: Aktie ohne Fondssignal -> keine VP
  const stockSecs = [{ uuid: 'S', name: 'Siemens AG', isin: 'DE0007236101', currency: 'EUR' }];
  res = replay(mk({ txs: [tx('2022-12-01', 'BUY', 'A', 100, 9500)], prices: P, secs: stockSecs }), SET, '2024-05-01');
  check('heuristic: stock gets no VP', res.vpRows.length === 0, res.vpRows);
  // sonstiges_wp: keine VP, voller Gewinn steuerpflichtig, auch bei Kauf vor 2009
  res = replay(mk({ txs: [tx('2005-01-10', 'BUY', 'A', 10, 500), tx('2024-02-01', 'SELL', 'A', 10, 1200)], prices: P }), { ...SET, fundTypes: { IS: 'sonstiges_wp' } }, '2024-05-01');
  check('sonstiges_wp: no VP, no Bestandsschutz, no TFS', res.vpRows.length === 0 && near(res.realized[2024], 700), [res.vpRows, res.realized]);

  // Komplettverkauf zwischen Ex-Tag und Zahltag
  const orphan = (sellDate, divDate, depots = null) => replay(mk({ txs: [tx('2025-01-10', 'BUY', 'A', 10, 1000), tx(sellDate, 'SELL', 'A', 10, 1100)],
    dividends: [{ uuid: 'd', date: divDate, depots: ['A', 'B'], security: 'S', gross: 50 }], prices: P }), { ...SET, depots }, '2025-11-24');
  res = orphan('2025-05-01', '2025-05-11');
  check('orphan div: counted after TFS', near(res.distributions[2025], 35), res.distributions);
  check('orphan div: hint names depot', res.warnings.some(w => w.includes('ohne Bestand') && w.includes('Depot A')), res.warnings);
  res = orphan('2025-02-01', '2025-05-11');
  check('orphan div: older than 60 days ignored', !res.distributions[2025] && res.warnings.some(w => w.includes('ignoriert')), [res.distributions, res.warnings]);
  res = replay(mk({ txs: [tx('2025-01-10', 'BUY', 'A', 10, 1000), tx('2025-01-10', 'BUY', 'B', 30, 3000), tx('2025-05-01', 'SELL', 'A', 10, 1100), tx('2025-05-01', 'SELL', 'B', 30, 3300)],
    dividends: [{ uuid: 'd', date: '2025-05-11', depots: ['A', 'B'], security: 'S', gross: 40 }], prices: P }), { ...SET, depots: ['A'] }, '2025-11-24');
  check('orphan div: split by last holdings, only selected depot', near(res.distributions[2025], 40 * 0.25 * 0.7), res.distributions);
  res = orphan('2025-05-11', '2025-05-11');
  check('same-day div+sell: normal path, counted once, no orphan hint', near(res.distributions[2025], 35) && !res.warnings.some(w => w.includes('ohne Bestand')), [res.distributions, res.warnings]);
  // Übertrag leert das Quelldepot nicht „verwaist“: Bestand liegt im Zieldepot, normaler Pfad
  res = replay(mk({ txs: [tx('2025-01-10', 'BUY', 'A', 10, 1000), tx('2025-05-01', 'TRANSFER_OUT', 'A', 10, 1000, { transferKey: 'k1' }), tx('2025-05-01', 'TRANSFER_IN', 'B', 10, 1000, { transferKey: 'k1' })],
    dividends: [{ uuid: 'd', date: '2025-05-11', depots: ['A', 'B'], security: 'S', gross: 50 }], prices: P }), SET, '2025-11-24');
  // Review M5: Übertrag A→B, Verkauf aus B, Ausschüttung danach – nur B hatte den letzten Bestand
  const m5 = depots => replay(mk({ txs: [tx('2025-01-10', 'BUY', 'A', 10, 1000), tx('2025-05-01', 'TRANSFER_OUT', 'A', 10, 1000, { transferKey: 'k5' }),
    tx('2025-05-01', 'TRANSFER_IN', 'B', 10, 1000, { transferKey: 'k5' }), tx('2025-05-05', 'SELL', 'B', 10, 1100)],
    dividends: [{ uuid: 'd', date: '2025-05-15', depots: ['A', 'B'], security: 'S', gross: 100 }], prices: P }), { ...SET, depots }, '2025-11-24').distributions[2025] || 0;
  check('orphan after transfer: only target depot', near(m5(['A']), 0) && near(m5(['B']), 70) && near(m5(null), 70), [m5(['A']), m5(['B']), m5(null)]);
  check('transfer: dividend goes to target holdings, no orphan hint', near(res.distributions[2025], 35) && !res.warnings.some(w => w.includes('ohne Bestand')), [res.distributions, res.warnings]);
  const inc = (r, kind) => r.income.filter(e => e.kind === kind);
  res = replay({ ...mk({ txs: [tx('2023-01-10', 'BUY', 'A', 10, 1000), tx('2025-03-01', 'SELL', 'A', 5, 400), tx('2025-04-01', 'SELL', 'A', 5, 700)],
    dividends: [{ uuid: 'd', date: '2025-02-01', depots: ['A', 'B'], security: 'S', gross: 20 }], prices: P }), interest: [{ uuid: 'z', date: '2025-06-30', account: 'k', gross: 12.5 }] }, SET, '2025-11-24');
  check('income: one event per sale, loss and gain', inc(res, 'sonst').length === 2 && inc(res, 'sonst')[0].amount < 0 && inc(res, 'sonst')[1].amount > 0, inc(res, 'sonst'));
  check('income: sale amount equals realized', near(inc(res, 'sonst').reduce((s, e) => s + e.amount, 0), res.realized[2025], 0.011));
  check('income: dividend after TFS per depot', inc(res, 'div').length === 1 && inc(res, 'div')[0].owner === 'A' && near(inc(res, 'div')[0].amount, 14));
  check('income: interest per account', inc(res, 'zins').length === 1 && inc(res, 'zins')[0].owner === 'k' && near(inc(res, 'zins')[0].amount, 12.5));
  check('income: VP of Y counted on Y+1-01-02', inc(res, 'vp').every(e => e.date === `${e.year}-01-02` && res.vpRows.some(r => r.year === e.year - 1 && r.depot === e.owner)), inc(res, 'vp'));
  const stock = replay(mk({ txs: [tx('2005-01-10', 'BUY', 'A', 10, 500), tx('2024-02-01', 'SELL', 'A', 10, 1200)], prices: P, secs: [{ uuid: 'S', name: 'Siemens AG', isin: 'DE0007236101', currency: 'EUR' }] }), SET, '2024-05-01');
  check('income: Bestandsschutz sale has no event', stock.income.filter(e => e.kind === 'aktie').length === 0);
  // Fix: genau ein div-Event je Ausschüttung und Depot, auch bei mehreren Lots
  res = replay(mk({ txs: [tx('2025-01-10', 'BUY', 'A', 4, 400), tx('2025-01-11', 'BUY', 'A', 6, 600), tx('2025-01-12', 'BUY', 'B', 5, 500), tx('2025-01-13', 'BUY', 'B', 5, 500)],
    dividends: [{ uuid: 'd2', date: '2025-05-01', depots: ['A', 'B'], security: 'S', gross: 100 }], prices: P }), SET, '2025-11-24');
  check('income: one div event per depot with several lots', inc(res, 'div').length === 2 && ['A', 'B'].every(d => inc(res, 'div').filter(e => e.owner === d).length === 1), inc(res, 'div'));
  check('income: div events sum equals distributions', near(inc(res, 'div').reduce((s, e) => s + e.amount, 0), res.distributions[2025], 0.011), [inc(res, 'div'), res.distributions]);
  const vpRes = replay(mk({ txs: [tx('2023-01-10', 'BUY', 'A', 100, 10000)], prices: P }), SET, '2025-11-24');
  check('income: VP events exist', inc(vpRes, 'vp').length > 0 && inc(vpRes, 'vp').every(e => e.date === `${e.year}-01-02`), [inc(vpRes, 'vp'), vpRes.vpRows]);
  res = orphan('2025-05-01', '2025-05-11');
  check('income: orphan distribution emits div event', inc(res, 'div').length === 1 && inc(res, 'div')[0].owner === 'A' && near(inc(res, 'div')[0].amount, 35), inc(res, 'div'));
  const taxStock = replay(mk({ txs: [tx('2020-01-10', 'BUY', 'A', 10, 500), tx('2024-02-01', 'SELL', 'A', 10, 1200)], prices: P, secs: [{ uuid: 'S', name: 'Siemens AG', isin: 'DE0007236101', currency: 'EUR' }] }), SET, '2024-05-01');
  check('income: taxable stock sale emits aktie event', inc(taxStock, 'aktie').length === 1 && near(inc(taxStock, 'aktie')[0].amount, 700), taxStock.income);

  // B1: Ausschüttung im März, Kauf im Oktober → der neue Lot erbt die Ausschüttung je Stück des Jahres
  const PB1 = [['2024-12-30', 100], ['2025-12-30', 120], ['2026-11-20', 125]];
  const div = depots => [{ uuid: 'd1', date: '2025-03-15', depots, security: 'S', gross: 100 }];
  let b1 = replay(mk({ txs: [tx('2024-06-01', 'BUY', 'A', 100, 10000), tx('2025-10-10', 'BUY', 'A', 100, 11500)], dividends: div(['A']), prices: PB1 }), SET, '2026-11-27');
  check('B1: old lot unchanged', near(b1.lots[0].vpCum, 77.1, 0.006), b1.lots[0].vpCum);
  check('B1: late lot inherits distribution', near(b1.lots[1].vpCum, 77.1 * 3 / 12, 0.006), b1.lots[1].vpCum);
  b1 = replay(mk({ txs: [tx('2024-06-01', 'BUY', 'A', 100, 10000), tx('2025-10-10', 'BUY', 'B', 100, 11500)], dividends: div(['A', 'B']), prices: PB1 }), SET, '2026-11-27');
  check('B1: sibling depot inherits', near(b1.lots.find(l => l.depot === 'B').vpCum, 77.1 * 3 / 12, 0.006), b1.lots.map(l => l.vpCum));
  b1 = replay(mk({ txs: [tx('2024-06-01', 'BUY', 'A', 100, 10000), tx('2025-10-10', 'BUY', 'B', 100, 11500)], dividends: div(['A']), prices: PB1 }), SET, '2026-11-27');
  check('B1: foreign account not inherited', near(b1.lots.find(l => l.depot === 'B').vpCum, 177.1 * 3 / 12, 0.006), b1.lots.map(l => l.vpCum));
  b1 = replay(mk({ txs: [tx('2024-06-01', 'BUY', 'A', 100, 10000), tx('2026-02-10', 'BUY', 'A', 10, 1200)], dividends: div(['A']), prices: PB1 }), SET, '2026-11-27');
  check('B1: next-year lot has no 2025 distribution', !(b1.lots[1].divPS[2025] > 0), b1.lots[1].divPS);

  // B4: Kurs zum Jahresbeginn mit Rückfall auf den ersten Kurs des Jahres; Hinweis bei fehlendem Basiszins des laufenden Jahres
  const pys = g('priceAtYearStart');
  check('B4: prior-year price wins', pys([['2024-12-30', 100], ['2025-01-02', 101]], 2025) === 100);
  check('B4: falls back to first price of the year', pys([['2025-01-02', 101], ['2025-02-01', 105]], 2025) === 101);
  check('B4: nothing within 10 days', pys([['2025-01-11', 101]], 2025) === null);
  let r4 = replay(mk({ txs: [tx('2025-01-02', 'BUY', 'A', 100, 10000)], prices: [['2025-01-02', 100], ['2025-12-30', 120], ['2026-11-20', 125]] }), SET, '2026-11-27');
  check('B4: VP 2025 computed when history starts Jan 2', r4.vpRows.some(x => x.year === 2025 && x.vp > 0), r4.warnings);
  r4 = replay(mk({ txs: [tx('2025-01-02', 'BUY', 'A', 100, 10000)], prices: [['2025-01-02', 100], ['2026-12-30', 120]] }), SET, '2027-01-05');
  check('B4: missing base rate of current year is reported', r4.warnings.some(w => w.includes('Kein Basiszins für 2027')), r4.warnings);
  r4 = replay(mk({ txs: [], prices: [] }), SET, '2027-01-05');
  check('B4: no base-rate warning without holdings', !r4.warnings.length, r4.warnings);

  // B10: Vorabpauschale fließt am ersten Werktag des Jahres zu
  const vid = g('vpInflowDate');
  check('B10: 2026 Friday', vid(2026) === '2026-01-02', vid(2026));
  check('B10: 2027 Jan 2 is Saturday', vid(2027) === '2027-01-04', vid(2027));
  check('B10: 2028 Jan 2 is Sunday', vid(2028) === '2028-01-03', vid(2028));

  // Schlussprüfung M3: die Vorabpauschale des Vorjahres zählt ab Jahresbeginn, auch wenn der erste Werktag erst der 04.01. ist
  let m3 = replay(mk({ txs: [tx('2025-06-02', 'BUY', 'A', 100, 10000)], prices: [['2025-12-30', 100], ['2026-12-30', 120]] }), SET, '2027-01-01');
  check('M3: VP 2026 is income of 2027 from Jan 1, dated first working day', inc(m3, 'vp').some(e => e.year === 2027 && e.date === '2027-01-04' && e.amount > 0), inc(m3, 'vp'));
  // Schlussprüfung M5: nach einem Übertrag auf ein anderes Konto erbt ein späterer Kauf im Zieldepot die Ausschüttung
  const mk2 = d => ({ ...mk(d), portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'k' }, { uuid: 'B', name: 'Depot B', accountUuid: 'k2' }] });
  const m5r = replay(mk2({ txs: [tx('2024-06-01', 'BUY', 'A', 100, 10000), tx('2025-06-02', 'TRANSFER_OUT', 'A', 100, 11000, { transferKey: 'm5' }), tx('2025-06-02', 'TRANSFER_IN', 'B', 100, 11000, { transferKey: 'm5' }),
    tx('2025-10-10', 'BUY', 'B', 100, 11500)], dividends: div(['A']), prices: PB1 }), SET, '2026-11-27');
  check('M5: buy after transfer inherits from the moved lot', m5r.lots.length === 2 && near(m5r.lots[0].vpCum, 77.1, 0.006) && near(m5r.lots[1].vpCum, 77.1 * 3 / 12, 0.006), m5r.lots.map(l => [l.depot, l.vpCum, l.divPS]));
};
