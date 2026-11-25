const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: { '2025|A': 1000 }, fundTypes: {}, depots: ['A'], bankOf: {}, fsa: {}, vortrag: {}, zinsen: {} };
const data = { securities: [{ uuid: 'X', name: 'X', isin: 'IEX', currency: 'EUR' }, { uuid: 'Y', name: 'Y', isin: 'IEY', currency: 'EUR' }], portfolios: [{ uuid: 'A', name: 'A' }], accounts: [], interest: [], txs: [], dividends: [], prices: new Map(), warnings: [] };
const lot = (id, security, buyDate, shares, cost, vpCum = 0, depot = 'A') => ({ id, depot, security, buyDate, shares, cost, vpCum, divPS: {} });
const res = (lots, prices, extra = {}) => ({ lots, vpRows: [], income: [], vpForecast: [], errors: [], warnings: [], realized: {}, latest: new Map(Object.entries(prices).map(([k, v]) => [k, ['2025-11-20', v]])), ...extra });

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
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50)], { X: 100 }), data, { ...SET, genutzt: {} }, 2025, 1000);
  check('plan: allowance makes shares tax-free', p.rows.length === 1 && near(p.rows[0].shares, 10, 1e-8) && p.tax === 0 && near(p.allowanceUsed, 350), p);
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50)], { X: 100 }), data, { ...SET, genutzt: {} }, 2025, 5000);
  const n1 = 1000 / 35, n = Math.ceil((n1 + (5000 - n1 * 100) / (100 - 35 * rate)) * 1e8) / 1e8;
  check('plan: allowance then taxed', near(p.rows[0].shares, n, 1e-8) && near(p.allowanceUsed, 1000) && near(p.tax, (n * 35 - 1000) * rate, 0.011), [p.rows[0].shares, n, p.tax]);

  // Einzelaktie vor 2009: steuerfrei
  p = plan(res([lot(1, 'X', '2005-05-05', 10, 10)], { X: 100 }), data, { ...SET, fundTypes: { IEX: 'einzelaktie' } }, 2025, 300);
  check('plan: Bestandsschutz exempt', p.rows[0].exempt === true && p.tax === 0 && near(p.rows[0].shares, 3, 1e-8), p.rows[0]);

  // Verlust ohne andere Erträge im Jahr: keine Steuer (Verlust geht in den Topf)
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
  p = plan(res([lot(1, 'X', '2020-01-01', 2, 99), lot(2, 'Y', '2020-01-01', 3, 99)], { X: 100, Y: 100 }), data, { ...SET, gebuehrFix: 5 }, 2025, 400);
  check('fees: one fixed fee per security', p.rows.length === 2 && p.rows.every(r => r.fee === 5) && near(p.fees, 10), p.rows.map(r => [r.lot.security, r.fee]));
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }), data, { ...SET, gebuehrFix: 5 }, 2025, 200);
  check('fees: loss lot stays tax-free', p.tax === 0 && p.rows[0].taxable === 0 && p.net > 199.99, p.rows[0]);

  // Kleiner, steuergünstigster Lot X würde eine zweite Order erzwingen: mit Fixgebühr lieber nur Y
  const fee = { ...SET, gebuehrFix: 10 };
  p = plan(res([lot(1, 'X', '2020-01-01', 1, 99), lot(2, 'Y', '2020-01-01', 100, 90)], { X: 100, Y: 100 }), data, fee, 2025, 500);
  check('plan fee: single order instead of two', p.rows.length === 1 && p.rows[0].lot.security === 'Y' && near(p.fees, 10) && p.reached, p.rows.map(r => [r.lot.security, r.shares]));
  p = plan(res([lot(1, 'X', '2020-01-01', 1, 99), lot(2, 'Y', '2020-01-01', 100, 90)], { X: 100, Y: 100 }), data, SET, 2025, 500);
  check('plan fee 0: unchanged order (X first)', p.rows[0].lot.security === 'X' && p.rows.length === 2, p.rows.map(r => r.lot.security));
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 95)], { X: 100 }), data, fee, 2025, 500);
  check('plan fee: one security, one order', p.rows.length === 1 && near(p.fees, 10) && p.net >= 500 && p.net < 500.01, p);

  // Review I1: kleiner Kopf-Lot, dahinter Verlust-Lots desselben Wertpapiers. Die Order läuft über die Lots weiter,
  // die Fixgebühr fällt nur einmal an – der Plan darf nicht teurer werden als ohne Gebührenbewertung (0.2)
  const i1 = [lot(1, 'X', '2015-01-01', 1, 95), lot(2, 'X', '2016-01-01', 100, 120), lot(3, 'Y', '2015-01-01', 100, 50)];
  p = plan(res(i1, { X: 100, Y: 100 }), data, { ...SET, gebuehrFix: 10 }, 2025, 3000);
  check('plan fee I1: sells the loss lots of X, no tax', p.reached && p.tax === 0 && near(p.fees, 10) && p.rows.every(r => r.lot.security === 'X'), [p.tax, p.fees, p.rows.map(r => [r.lot.security, r.shares])]);

  // Erstattung: dieses Jahr schon 2000 Fondsgewinn (FSA verbraucht), Verlust-Lot -500 stpfl. -> negative Steuer
  const done = { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'sonst', amount: 2000 }] };
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }, done), data, { ...SET, genutzt: {}, fundTypes: { IEX: 'sonstige' } }, 2025, 300);
  check('plan: loss triggers refund', p.rows[0].tax < 0 && near(p.rows[0].tax, -p.rows[0].shares * 50 * rate, 0.02) && near(p.net, 300, 0.011), p.rows[0]);
  // Aktienverlust ohne Aktiengewinne im Jahr: keine Erstattung
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }, done), data, { ...SET, genutzt: {}, fundTypes: { IEX: 'einzelaktie' } }, 2025, 300);
  check('plan: stock loss without stock gains -> no refund', near(p.rows[0].tax, 0), p.rows[0]);
  check('plan: stock loss grows stock pot', p.banks.length === 1 && p.banks[0].potsUsed.aktien < 0 && near(p.banks[0].potsUsed.aktien, -p.rows[0].shares * 50, 0.011), p.banks);
  // Review Focus 4: Ziel unerreichbar, Summen konsistent auch bei negativer Steuer
  p = plan(res([lot(1, 'X', '2020-01-01', 1, 150)], { X: 100 }, done), data, { ...SET, genutzt: {}, fundTypes: { IEX: 'sonstige' } }, 2025, 5000);
  check('plan: unreachable with refund, sums consistent', !p.reached && near(p.net, p.gross - p.fees - p.tax, 0.011), p);

  // Je Bank getrennt: zwei Banken mit eigenem FSA; Gewinn bei B nutzt nur den FSA von B
  const two = { ...data, portfolios: [{ uuid: 'A', name: 'Bank A' }, { uuid: 'B', name: 'Bank B' }] };
  const S2 = { ...SET, genutzt: {}, depots: ['A', 'B'], fsa: { A: 800, B: 200 }, fundTypes: { IEX: 'sonstige', IEY: 'sonstige' } };
  p = plan(res([lot(1, 'Y', '2020-01-01', 100, 50, 0, 'B')], { Y: 100 }), two, S2, 2025, 2000);
  const nB = 200 / 50 + (2000 - 400) / (100 - 50 * rate);
  check('plan: per bank FSA', p.rows.every(r => r.bank === 'B') && near(p.allowanceUsed, 200) && near(p.tax, (nB * 50 - 200) * rate, 0.011)
    && p.banks.length === 1 && p.banks[0].key === 'B' && p.banks[0].label === 'Bank B' && near(p.banks[0].fsaUsed, 200) && near(p.banks[0].tax, p.tax), p);
  // Gemeinsamer Modus (zwei aktive Banken, kein FSA eingetragen): gemeinsamer spb
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50), lot(2, 'Y', '2020-01-01', 100, 50, 0, 'B')], { X: 100, Y: 100 }), two, { ...S2, fsa: {} }, 2025, 2000);
  check('plan: pooled FSA shared', p.tax === 0 && near(p.allowanceUsed, 1000) && near(p.gross, 2000), p);
  // Topf vor FSA: allgemeiner Vortrag 300 bei A wird vor dem FSA verbraucht
  p = plan(res([lot(1, 'X', '2020-01-01', 100, 50)], { X: 100 }), data, { ...SET, genutzt: {}, vortrag: { '2025|A': { aktien: 0, allg: 300 } }, fundTypes: { IEX: 'sonstige' } }, 2025, 2600);
  check('plan: pot before FSA', p.tax === 0 && near(p.allowanceUsed, 1000) && near(p.banks[0].potsUsed.allg, 300) && near(p.rows[0].shares, 26, 1e-8), p);
  // Verlust-Lot senkt die Steuer eines späteren Gewinns im selben Plan
  p = plan(res([lot(1, 'X', '2020-01-01', 1, 400), lot(2, 'Y', '2020-01-01', 100, 50)], { X: 100, Y: 100 }), data, { ...SET, fundTypes: { IEX: 'sonstige', IEY: 'sonstige' } }, 2025, 1000);
  check('plan: loss lot first, offsets later gain', p.rows[0].lot.security === 'X' && p.rows[0].tax === 0 && near(p.tax, (p.rows[1].shares * 50 - 300) * rate, 0.011), p.rows);
};
