const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: 1000, fundTypes: {}, depots: null };
const data = { securities: [{ uuid: 'X', name: 'X', isin: 'IEX', currency: 'EUR' }, { uuid: 'Y', name: 'Y', isin: 'IEY', currency: 'EUR' }], portfolios: [{ uuid: 'A', name: 'A' }], txs: [], dividends: [], prices: new Map(), warnings: [] };
const lot = (id, security, buyDate, shares, cost, vpCum = 0) => ({ id, depot: 'A', security, buyDate, shares, cost, vpCum, divPS: {} });
const res = (lots, prices) => ({ lots, vpRows: [], errors: [], warnings: [], realized: {}, latest: new Map(Object.entries(prices).map(([k, v]) => [k, ['2025-11-20', v]])) });

export default ({ g, check, near }) => {
  const plan = g('planNetSale');
  const rate = 0.26375;

  // Geringe Steuer zuerst: Y (älter, hoher Gewinn) wird nach X verkauft
  let p = plan(res([lot(1, 'Y', '2019-01-01', 10, 50), lot(2, 'X', '2020-01-01', 10, 95)], { X: 100, Y: 100 }), data, SET, 2025, 500);
  const taxPS = 5 * 0.7 * rate;
  check('plan: low tax lot first', p.rows[0].lot.security === 'X', p.rows.map(r => r.lot.security));
  check('plan: exact share count', near(p.rows[0].shares, Math.ceil(500 / (100 - taxPS) * 1e8) / 1e8, 1e-8), p.rows[0].shares);
  check('plan: reached, net >= target', p.reached && p.net >= 500 && p.net < 500.01, p);
  check('plan: tax = gross - net', near(p.gross - p.tax, p.net, 0.011), p);

  // Freibetrag zuerst verbrauchen
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50)], { X: 100 }), data, { ...SET, genutzt: 0 }, 2025, 1000);
  check('plan: allowance makes shares tax-free', p.rows.length === 1 && near(p.rows[0].shares, 10, 1e-8) && p.tax === 0 && near(p.allowanceUsed, 350), p);
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50)], { X: 100 }), data, { ...SET, genutzt: 0 }, 2025, 5000);
  const n1 = 1000 / 35, n = Math.ceil((n1 + (5000 - n1 * 100) / (100 - 35 * rate)) * 1e8) / 1e8;
  check('plan: allowance then taxed', near(p.rows[0].shares, n, 1e-8) && near(p.allowanceUsed, 1000) && near(p.tax, (n * 35 - 1000) * rate, 0.011), [p.rows[0].shares, n, p.tax]);

  // Einzelaktie vor 2009: steuerfrei
  p = plan(res([lot(1, 'X', '2005-05-05', 10, 10)], { X: 100 }), data, { ...SET, fundTypes: { IEX: 'einzelaktie' } }, 2025, 300);
  check('plan: Bestandsschutz exempt', p.rows[0].exempt === true && p.tax === 0 && near(p.rows[0].shares, 3, 1e-8), p.rows[0]);

  // Verlust: keine Steuer, keine Verrechnung
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }), data, SET, 2025, 200);
  check('plan: loss lot tax 0, gain negative', p.tax === 0 && p.rows[0].gain < 0 && p.rows[0].taxable === 0, p.rows[0]);

  // Review Focus: Ziel nicht erreichbar
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 100), lot(2, 'Y', '2020-01-01', 5, 100)], { X: 100, Y: 100 }), data, SET, 2025, 1e6);
  check('plan: unreachable -> partial', !p.reached && near(p.gross, 1500) && near(p.net, 1500) && p.rows.length === 2, p);

  // FIFO innerhalb eines Wertpapiers: jüngerer Lot nie vor älterem
  p = plan(res([lot(1, 'X', '2019-01-01', 5, 20), lot(2, 'X', '2021-01-01', 5, 99)], { X: 100 }), data, SET, 2025, 700);
  check('plan: FIFO within security', p.rows[0].lot.id === 1 && near(p.rows[0].shares, 5, 1e-8) && p.rows[1].lot.id === 2, p.rows.map(r => [r.lot.id, r.shares]));

  // Ordergebühren: fest je Order (Depot × Wertpapier) plus % vom Erlös; mindern Gewinn und Netto
  check('fees: default none', plan(res([lot(1, 'X', '2020-01-01', 10, 95)], { X: 100 }), data, SET, 2025, 300).fees === 0);
  const SF = { ...SET, gebuehrFix: 5, gebuehrProz: 0.25 };
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 95)], { X: 100 }), data, SF, 2025, 500);
  const r0 = p.rows[0];
  check('fees: fix + percent of gross', near(r0.fee, 5 + 0.0025 * r0.gross, 0.006) && near(p.fees, r0.fee), r0);
  check('fees: fee lowers taxable gain', near(r0.taxable, (r0.shares * 5 - r0.fee) * 0.7, 0.006) && near(r0.tax, r0.taxable * rate, 0.006), r0);
  check('fees: net = gross - fee - tax, target met', p.reached && near(p.net, p.gross - p.fees - p.tax, 0.011) && p.net > 499.99 && p.net < 500.02, p);
  p = plan(res([lot(1, 'X', '2019-01-01', 5, 90), lot(2, 'X', '2020-01-01', 50, 95)], { X: 100 }), data, { ...SET, gebuehrFix: 5 }, 2025, 800);
  check('fees: fixed fee once per order (depot x security)', p.rows.length === 2 && p.rows[0].fee === 5 && p.rows[1].fee === 0, p.rows.map(r => r.fee));
  p = plan(res([lot(1, 'X', '2020-01-01', 2, 99), lot(2, 'Y', '2020-01-01', 50, 99)], { X: 100, Y: 100 }), data, { ...SET, gebuehrFix: 5 }, 2025, 400);
  check('fees: one fixed fee per security', p.rows.length === 2 && p.rows.every(r => r.fee === 5) && near(p.fees, 10), p.rows.map(r => [r.lot.security, r.fee]));
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }), data, { ...SET, gebuehrFix: 5 }, 2025, 200);
  check('fees: loss lot stays tax-free', p.tax === 0 && p.rows[0].taxable === 0 && p.net > 199.99, p.rows[0]);
};
