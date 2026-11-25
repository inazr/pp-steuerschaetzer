// Ausschüttungen in der Freibetrag-Vorbelegung und Prognose der Vorabpauschale des laufenden Jahres
let n = 0;
const tx = (date, type, depot, shares, amount) => ({ uuid: 'f' + (++n), date, type, depot, security: 'S', shares, amount, fees: 0, taxes: 0 });
const mk = (txs, dividends, prices) => ({
  securities: [{ uuid: 'S', name: 'ETF', isin: 'IS', wkn: '', currency: 'EUR' }],
  portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'k' }, { uuid: 'B', name: 'Depot B', accountUuid: 'k' }],
  txs, dividends, prices: new Map([['S', prices]]), warnings: [],
});
const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: null, fundTypes: {}, depots: null };
const P = [['2022-12-30', 100], ['2023-12-29', 101], ['2024-12-30', 110], ['2025-11-20', 120]];

export default ({ g, check, near }) => {
  const replay = g('replay'), prefill = g('prefillUsed');

  // Ausschüttungen des laufenden Jahres verbrauchen den Freibetrag (nach Teilfreistellung, nur ausgewählte Depots)
  const div = mk([tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2022-12-01', 'BUY', 'B', 300, 30000)],
    [{ uuid: 'd', date: '2025-06-02', depots: ['A', 'B'], security: 'S', gross: 400 }], P);
  const all = replay(div, SET, '2025-11-24'), onlyA = replay(div, { ...SET, depots: ['A'] }, '2025-11-24');
  check('dist: taxable distributions per year (30 % TFS)', near(all.distributions[2025], 280), all.distributions);
  check('dist: only selected depots', near(onlyA.distributions[2025], 70), onlyA.distributions);
  const vpA = onlyA.vpRows.filter(r => r.year === 2024).reduce((s, r) => s + r.taxable, 0);
  check('dist: prefill = VP prev year + distributions + sales', near(prefill(onlyA, SET, 2025), vpA + 70), [prefill(onlyA, SET, 2025), vpA]);
  const aktie = replay(div, { ...SET, fundTypes: { IS: 'einzelaktie' } }, '2025-11-24');
  check('dist: single stock dividends fully taxable', near(aktie.distributions[2025], 400), aktie.distributions);

  // Prognose: wie ein Jahresabschluss zum letzten Kurs, ohne die Lots zu verändern
  const base = [tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2025-03-10', 'BUY', 'A', 10, 1100)];
  const f = replay(mk(base, [], P), SET, '2025-11-24');
  const closed = replay(mk(base, [], [...P, ['2025-12-31', 120]]), SET, '2026-01-05');
  const exp = closed.vpRows.filter(r => r.year === 2025);
  check('forecast: same as closing the year at the latest price', f.vpForecast.length === 1 && exp.length === 1
    && near(f.vpForecast[0].vp, exp[0].vp) && near(f.vpForecast[0].taxable, exp[0].taxable) && near(f.vpForecast[0].tax, exp[0].tax) && f.vpForecast[0].vp > 0,
    [f.vpForecast, exp]);
  check('forecast: year and price date', f.vpForecast[0].year === 2025 && f.vpForecast[0].priceDate === '2025-11-20', f.vpForecast[0]);
  check('forecast: not in vpRows, lots untouched', f.vpRows.every(r => r.year < 2025) && f.lots.find(l => l.buyDate === '2025-03-10').vpCum === 0
    && near(f.lots.find(l => l.buyDate === '2022-12-01').vpCum, f.vpRows.reduce((s, r) => s + r.vp, 0)), f.lots.map(l => l.vpCum));
  check('forecast: follows depot filter', replay(mk(base, [], P), { ...SET, depots: ['B'] }, '2025-11-24').vpForecast.length === 0);
  const noStart = replay(mk(base, [], [['2025-06-02', 110], ['2025-11-20', 120]]), SET, '2025-11-24');
  check('forecast: no price on 01.01. -> skipped with warning', noStart.vpForecast.length === 0 && noStart.warnings.some(w => w.includes('Prognose')), noStart.warnings);
  check('forecast: none for single stocks', replay(mk(base, [], P), { ...SET, fundTypes: { IS: 'einzelaktie' } }, '2025-11-24').vpForecast.length === 0);

  // Restfreibetrag des Folgejahres nach der prognostizierten Vorabpauschale
  const next = g('allowanceNextYear');
  const a1 = next(f, SET, 2025), fcT = f.vpForecast.reduce((s, r) => s + r.taxable, 0);
  check('next: VP uses next year allowance', a1.year === 2026 && a1.total === 1000 && near(a1.used, fcT) && near(a1.remaining, 1000 - fcT) && a1.taxAfter === 0, a1);
  check('next: joint 2000', next(f, { ...SET, veranlagung: 'joint' }, 2025).total === 2000);
  const big = next({ vpForecast: [{ taxable: 900 }, { taxable: 300 }] }, SET, 2025);
  check('next: above allowance -> remaining 0, tax on excess', big.remaining === 0 && near(big.used, 1200) && near(big.taxAfter, 200 * 0.26375, 0.006), big);
  check('next: no forecast -> full allowance', next({ vpForecast: [] }, SET, 2025).remaining === 1000);
};
