// Umstellung zum 31.12.2017 (§ 56 InvStG): fiktive Veräußerung von Fondsanteilen
let n = 0;
const tx = (date, type, depot, shares, amount, extra = {}) => ({ uuid: 'a' + (++n), date, type, depot, security: 'S', shares, amount, fees: 0, taxes: 0, ...extra });
const mk = (txs, dividends, prices) => ({
  securities: [{ uuid: 'S', name: 'ETF', isin: 'IS', wkn: '', currency: 'EUR' }],
  portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'k' }, { uuid: 'B', name: 'Depot B', accountUuid: 'k' }],
  txs, dividends, prices: new Map([['S', prices]]), warnings: [],
});
const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: null, fundTypes: {}, depots: null };

export default ({ g, check, near }) => {
  const replay = g('replay');
  const P = [['2014-12-30', 90], ['2017-12-29', 150], ['2018-12-28', 150], ['2019-12-30', 150], ['2020-12-30', 150], ['2025-12-30', 150]];
  let r = replay(mk([tx('2015-03-02', 'BUY', 'A', 10, 1000)], [], P), SET, '2026-11-26');
  check('alt: lot switched at 31.12.2017', near(r.lots[0].cost, 150) && near(r.lots[0].origCost, 100) && near(r.lots[0].alt.gainPS, 50) && r.lots[0].alt.pre2009 === false, r.lots[0]);
  r = replay(mk([tx('2005-03-02', 'BUY', 'A', 10, 1000)], [], [['2004-12-30', 90], ...P]), SET, '2026-11-26');
  check('alt: pre-2009 flag', r.lots[0].alt.pre2009 === true);
  r = replay(mk([tx('2015-03-02', 'BUY', 'A', 10, 1000), tx('2019-05-02', 'SELL', 'A', 4, 600),
    tx('2020-01-06', 'TRANSFER_OUT', 'A', 6, 900, { transferKey: 't' }), tx('2020-01-06', 'TRANSFER_IN', 'B', 6, 900, { transferKey: 't' })], [], P), SET, '2026-11-26');
  check('alt: split and transfer keep alt', r.lots.length === 1 && r.lots[0].depot === 'B' && near(r.lots[0].shares, 6) && near(r.lots[0].alt.price, 150) && near(r.lots[0].origCost, 100), r.lots);
  r = replay(mk([tx('2015-03-02', 'BUY', 'A', 10, 1000)], [], [['2019-01-02', 150], ['2025-12-30', 150]]), SET, '2026-11-26');
  check('alt: missing 2017 price → hint, unchanged', !r.lots[0].alt && near(r.lots[0].cost, 100) && r.warnings.some(w => w.includes('Kein Kurs zum 31.12.2017')), r.warnings);
  r = replay(mk([tx('2015-03-02', 'BUY', 'A', 10, 1000)], [], P), { ...SET, fundTypes: { IS: 'einzelaktie' } }, '2026-11-26');
  check('alt: stock not switched', !r.lots[0].alt && near(r.lots[0].cost, 100));
  const sell = (buy, at, extraP = []) => replay(mk([tx(buy, 'BUY', 'A', 10, 1000), tx('2020-06-02', 'SELL', 'A', 10, at * 10)], [], [...extraP, ...P]), SET, '2026-11-26');
  const ev = r => r.income.filter(e => e.kind === 'sonst');
  let r2 = sell('2015-03-02', 180);
  check('sale 2015 lot: new gain with TFS + old gain without', near(ev(r2)[0].amount, 30 * 10 * 0.7 + 50 * 10) && r2.veranlagung.length === 0, [ev(r2), r2.veranlagung]);
  r2 = sell('2005-03-02', 180, [['2004-12-30', 90]]);
  check('sale pre-2009 lot: old gain tax-free, alt100k = raw', near(ev(r2)[0].amount, 210) && r2.veranlagung.length === 1 && r2.veranlagung[0].kind === 'alt100k' && near(r2.veranlagung[0].amount, 300), r2.veranlagung);
  r2 = sell('2015-03-02', 120);
  check('BFH: fiction loss counts fully (extra 90)', near(ev(r2)[0].amount, -30 * 10 * 0.7 + 500) && r2.veranlagung[0].kind === 'bfh' && near(r2.veranlagung[0].amount, 90), r2.veranlagung);
  r2 = sell('2015-03-02', 80);
  check('BFH: only up to old gain (F=500 → 150)', near(r2.veranlagung[0].amount, 150), r2.veranlagung);
  const PV = [['2014-12-30', 90], ['2017-12-29', 150], ['2018-12-28', 160], ['2019-12-30', 160], ['2025-12-30', 160]];
  r2 = replay(mk([tx('2015-03-02', 'BUY', 'A', 10, 1000), tx('2020-06-02', 'SELL', 'A', 10, 1500)], [], PV), SET, '2026-11-26');
  check('BFH: VP-only negative raw is no fiction loss', !r2.veranlagung.some(v => v.kind === 'bfh'), r2.veranlagung);
  const AF = g('altFreibetrag');
  const res = (post, income = []) => ({ veranlagung: post, income, lots: [], vpForecast: [] });
  const post = (year, amount, kind = 'alt100k', tfs = 0.3) => ({ year, date: `${year}-06-01`, depot: 'A', kind, amount, tfs });
  const led = { rate: 0.26375, banks: [{ positiveEff: 50000, used: 1000 }] };
  let a = AF(res([post(2019, 30000), post(2020, 20000), post(2026, 5000)]), {}, { veranlagung: 'single', depots: ['A'], altFb: {} }, 2026, led);
  check('100k: computed left', a.leftStartComputed === 50000 && a.usedThisYear === 5000 && a.left === 45000 && !a.leftStartOverridden, a);
  check('100k: refund this year', near(a.refund100k, 0.26375 * 5000 * 0.7, 0.02), a);
  a = AF(res([post(2019, 30000)]), {}, { veranlagung: 'joint', depots: ['A'], altFb: {} }, 2026, led);
  check('100k: joint 200k', a.total === 200000 && a.leftStartComputed === 170000 && a.joint, a);
  a = AF(res([post(2026, 5000)]), {}, { veranlagung: 'joint', depots: ['A'], altFb: { A: 999999 } }, 2026, led);
  check('100k: override capped to total', a.leftStart === 200000 && a.leftStartOverridden && a.left === 195000, a);
  a = AF(res([post(2026, 5000)]), {}, { veranlagung: 'single', depots: ['A'], altFb: { A: 2000 } }, 2026, led);
  check('100k: override = left per last notice', a.leftStart === 2000 && a.left === 0 && near(a.refund100k, 0.26375 * 2000 * 0.7, 0.02), a);
  a = AF(res([post(2026, 90, 'bfh')]), {}, { veranlagung: 'single', depots: ['A'], altFb: {} }, 2026, { rate: 0.26375, banks: [{ positiveEff: 50, used: 50 }] });
  check('bfh: refund capped by taxed base (0)', a.refundBfh === 0, a);
};
