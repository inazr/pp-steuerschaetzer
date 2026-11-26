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
};
