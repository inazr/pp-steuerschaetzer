// Dezember-Effekt: Verkauf + Rückkauf im Monat m → Vorabpauschale des laufenden Jahres nur (13 − m)/12
let n = 0;
const tx = (date, type, depot, shares, amount, security = 'S') => ({ uuid: 'd' + (++n), date, type, depot, security, shares, amount, fees: 0, taxes: 0 });
const SECS = [{ uuid: 'S', name: 'ETF', isin: 'IE00TEST0001', wkn: '', currency: 'EUR' }, { uuid: 'T', name: 'Siemens AG', isin: 'DE0007236101', wkn: '', currency: 'EUR' }];
const PRICES = [['2025-12-30', 100], ['2026-11-25', 110]];
const mk = txs => ({ securities: SECS, portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'k' }], accounts: [{ uuid: 'k', name: 'Konto', currency: 'EUR' }],
  interest: [], txs, dividends: [], prices: new Map([['S', PRICES], ['T', PRICES]]), warnings: [] });
const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', fundTypes: {}, depots: ['A'], bankOf: {}, fsa: {}, genutzt: {}, vortrag: {}, zinsen: {}, altFb: {} };

export default ({ g, check, near }) => {
  const replay = g('replay'), eff = g('decemberEffect');
  const run = (txs, today = '2026-11-26') => { const r = replay(mk(txs), SET, today); return { r, rows: r.lots.map(lot => ({ lot, shares: lot.shares })) }; };

  // Lot von 2020: 100 Stück, 1.1. 100 → 110, Basiszins 2026 3,20 % → 100 × 0,032 × 0,7 = 2,24 je Stück
  let { r, rows } = run([tx('2020-03-02', 'BUY', 'A', 100, 9000)]);
  const fl = r.vpForecastLots.find(x => x.lotId === r.lots[0].id);
  check('dez: forecast per lot', fl && near(fl.vpPS, 2.24, 1e-9) && near(fl.vpFullPS, 2.24, 1e-9) && fl.tfs === 0.3, fl);
  let e = eff(r, mk([]), SET, 2026, rows, '2026-11-26');
  check('dez: months from current month', JSON.stringify(e.months.map(m => m.month)) === '[11,12]', e.months.map(m => m.month));
  const dec = e.months.find(m => m.month === 12), nov = e.months.find(m => m.month === 11);
  check('dez: december reduction 11/12', near(dec.vpBefore - dec.vpAfter, 2.24 * 11 / 12 * 100, 0.01) && near(dec.taxableReduction, 2.24 * 11 / 12 * 100 * 0.7, 0.01), dec);
  check('dez: november reduction 10/12', near(nov.vpBefore - nov.vpAfter, 2.24 * 10 / 12 * 100, 0.01), nov);
  check('dez: next-year allowance grows by taxable reduction', near(dec.next.remainingAfter - dec.next.remainingBefore, dec.taxableReduction, 0.02), dec.next);
  check('dez: no tax saved while VP fits the allowance', dec.taxSaved === 0, dec);

  // Teilmenge: 50 von 100 Stück → halbe Minderung
  e = eff(r, mk([]), SET, 2026, [{ lot: r.lots[0], shares: 50 }], '2026-11-26');
  check('dez: partial lot proportional', near(e.months.find(m => m.month === 12).vpBefore - e.months.find(m => m.month === 12).vpAfter, 2.24 * 11 / 12 * 50, 0.01));

  // heute im Dezember → nur Monat 12
  e = eff(r, mk([]), SET, 2026, rows, '2026-12-05');
  check('dez: only december in december', JSON.stringify(e.months.map(m => m.month)) === '[12]');

  // Lot im März 2026 gekauft (b = 3): Prognose schon 10/12; Rückkauf im Dezember → 1/12 → Minderung 9/12; Monat ≤ 3 hätte keine Minderung
  ({ r, rows } = run([tx('2026-03-10', 'BUY', 'A', 100, 10500)]));
  const fl2 = r.vpForecastLots.find(x => x.lotId === r.lots[0].id);
  check('dez: own purchase month reflected', near(fl2.vpPS, 2.24 * 10 / 12, 1e-4) && near(fl2.vpFullPS, 2.24, 1e-9), fl2);
  e = eff(r, mk([]), SET, 2026, rows, '2026-11-26');
  check('dez: bought this year → reduction (m − b)/12', near(e.months.find(m => m.month === 12).vpBefore - e.months.find(m => m.month === 12).vpAfter, 2.24 * 9 / 12 * 100, 0.01));
  e = eff(r, mk([]), SET, 2026, rows, '2026-02-10');
  check('dez: no reduction before or at purchase month', e.months.filter(m => m.month <= 3).every(m => near(m.vpBefore, m.vpAfter, 1e-9)), e.months);

  // Einzelaktie: keine Vorabpauschale → keine Minderung
  ({ r, rows } = run([tx('2020-03-02', 'BUY', 'A', 100, 9000, 'T')]));
  e = eff(r, mk([]), SET, 2026, rows, '2026-11-26');
  check('dez: stock has no effect', e.months.every(m => near(m.vpBefore - m.vpAfter, 0, 1e-9)), e.months);

  // kein Basiszins für das Jahr → keine Prognose, leeres Ergebnis
  ({ r, rows } = run([tx('2020-03-02', 'BUY', 'A', 100, 9000)], '2031-11-26'));
  e = eff(r, mk([]), SET, 2031, rows, '2031-11-26');
  check('dez: no basiszins → empty', e.months.length === 0, e);
};
