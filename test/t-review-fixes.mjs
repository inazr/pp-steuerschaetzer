// Regressionstests aus dem abschließenden Review
let n = 0;
const tx = (date, type, depot, shares, amount, extra = {}) => ({ uuid: 'r' + (++n), date, type, depot, security: 'S', shares, amount, fees: 0, taxes: 0, ...extra });
const mk = (txs, dividends, prices) => ({
  securities: [{ uuid: 'S', name: 'ETF', isin: 'IS', currency: 'EUR' }],
  portfolios: [{ uuid: 'A', name: 'A', accountUuid: 'K' }, { uuid: 'B', name: 'B', accountUuid: 'K' }],
  txs, dividends, prices: new Map([['S', prices]]), warnings: [],
});
const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: null, fundTypes: {}, depots: null };
const P = [['2022-12-30', 100], ['2023-12-29', 101], ['2024-12-30', 110], ['2025-11-20', 120]];

export default ({ g, check, near }) => {
  const replay = g('replay'), prefill = g('prefillUsed');

  // I1: Ausschüttung an gemeinsamem Konto -> nach Bestand der Depots am Zahltag
  let res = replay(mk([tx('2021-03-01', 'BUY', 'A', 100, 9000), tx('2022-02-01', 'TRANSFER_OUT', 'A', 100, 9000, { transferKey: 'k' }), tx('2022-02-01', 'TRANSFER_IN', 'B', 100, 9000, { transferKey: 'k' })],
    [{ uuid: 'd', date: '2023-06-01', depots: ['A', 'B'], security: 'S', gross: 200 }], P), SET, '2024-03-01');
  const rb = res.vpRows.find(r => r.year === 2023 && r.depot === 'B');
  check('review I1: dividend follows holdings after transfer', rb && near(rb.ausschuettungen, 200) && rb.vp === 0, rb);
  res = replay(mk([tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2022-12-01', 'BUY', 'B', 300, 30000)],
    [{ uuid: 'd', date: '2023-06-01', depots: ['A', 'B'], security: 'S', gross: 100 }], P), SET, '2024-03-01');
  const ra = res.vpRows.find(r => r.year === 2023 && r.depot === 'A'), rb2 = res.vpRows.find(r => r.year === 2023 && r.depot === 'B');
  check('review I1: split pro rata by shares', ra && rb2 && near(ra.ausschuettungen, 25) && near(rb2.ausschuettungen, 75), [ra, rb2]);

  // I2: Depotfilter verändert die Vorbelegung nicht
  const data = mk([tx('2022-12-01', 'BUY', 'A', 100, 10000), tx('2022-12-01', 'BUY', 'B', 100, 10000), tx('2025-03-03', 'SELL', 'B', 10, 1150)], [], P);
  const all = replay(data, SET, '2025-11-24'), onlyA = replay(data, { ...SET, depots: ['A'] }, '2025-11-24');
  check('review I2: prefill independent of depot filter', near(prefill(onlyA, SET, 2025), prefill(all, SET, 2025)) && prefill(all, SET, 2025) > 0, [prefill(onlyA, SET, 2025), prefill(all, SET, 2025)]);
  check('review I2: displayed rows still filtered', onlyA.vpRows.every(r => r.depot === 'A'));

  // Realisierter Gewinn vor einbehaltener Steuer (PP-Betrag ist netto)
  const net = replay(mk([tx('2023-01-10', 'BUY', 'A', 10, 1000), tx('2025-02-01', 'SELL', 'A', 10, 1100)], [], P), SET, '2025-11-24');
  const withTax = replay(mk([tx('2023-01-10', 'BUY', 'A', 10, 1000), tx('2025-02-01', 'SELL', 'A', 10, 1090, { taxes: 10 })], [], P), SET, '2025-11-24');
  check('review: realized gain gross of withheld tax', near(withTax.realized[2025], net.realized[2025], 0.011), [withTax.realized[2025], net.realized[2025]]);

  // Abgeschnittene Datei: Fehler statt Endlosschleife
  for (const bad of ['<a><b>1</b><!-- x', '<a><![CDATA[abc', '<a><?pi', '<a><!DOCTYPE']) {
    let err = null; try { g('parseXml')(bad); } catch (e) { err = e; }
    check('review: truncated XML throws (' + bad.slice(-6) + ')', err && err.message === 'XML_BROKEN', err && err.message);
  }

  // Kurs ohne v-Attribut -> verworfen, kein NaN
  const xml = `<client><securities><security><uuid>S</uuid><name>E</name><currencyCode>EUR</currencyCode><prices><price t="2023-12-29"/><price t="2023-12-28" v="10000000000"/><price v="1"/></prices></security></securities><accounts/><portfolios/></client>`;
  const d = g('extractPortfolio')(xml);
  check('review: prices without v/t dropped', d.prices.get('S').length === 1 && d.prices.get('S')[0][1] === 100, d.prices.get('S'));
};
