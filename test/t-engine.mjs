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
};
