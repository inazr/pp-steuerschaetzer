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
  // Final review M2: genutzt-Override = FSA bei 3000 Gewinn im Jahr – der Verlust erstattet Steuer
  const done3 = { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'sonst', amount: 3000 }] };
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }, done3), data, { ...SET, genutzt: { '2025|A': 1000 }, fundTypes: { IEX: 'sonstige' } }, 2025, 5000);
  check('plan M2: genutzt override = fsa, loss refunds tax', p.rows.length === 1 && near(p.rows[0].shares, 10, 1e-8) && near(p.rows[0].tax, -500 * rate, 0.011), p.rows[0]);
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
  // Minor 15: Aktienverlust, wenn das Jahr schon Aktiengewinne hat (FSA verbraucht) -> Erstattung ≈ Verlust × Satz
  const stockDone = { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'aktie', amount: 2000 }] };
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }, stockDone), data, { ...SET, genutzt: {}, fundTypes: { IEX: 'einzelaktie' } }, 2025, 300);
  check('plan minor 15: stock loss refunds against stock gains', p.rows.length === 1 && p.rows[0].tax < 0 && near(p.rows[0].tax, -p.rows[0].shares * 50 * rate, 0.02) && p.net >= 300 && p.net < 300.01, p.rows[0]);
  // Minor 15: kleinste Stückzahl für einen Verlust-Lot mit Gebühr – 1e-8 Stück weniger reicht nicht
  p = plan(res([lot(1, 'X', '2020-01-01', 10, 150)], { X: 100 }), data, { ...SET, gebuehrFix: 5, gebuehrProz: 0.25 }, 2025, 200);
  const r15 = p.rows[0], m15 = r15.shares - 1e-8;
  const exact15 = m15 * 100 * (1 - 0.0025) - 5, rounded15 = Math.round((m15 * 100 - Math.round((5 + m15 * 100 * 0.0025) * 100) / 100) * 100) / 100;
  check('plan minor 15: minimal n for a loss lot with fee', p.rows.length === 1 && r15.tax === 0 && r15.net >= 200 && (exact15 < 200 - 1e-9 || rounded15 < 200 - 1e-9), [r15, exact15, rounded15]);
  dust({ g, check });
  timing({ g, check });
  altbestand({ g, check, near });
};
// v0.5 §4a/§5: Altbestand. X = Fonds-Lot vor 2009 (Kosten ab 2018 = Kurs 31.12.2017 = 150, ursprünglich 100),
// Kurs 170 -> raw 20/Stück (Aktienfonds: stpfl. 14/Stück, Altgewinn 50 steuerfrei, 100k-Posten = raw).
// Y = normaler Lot 2020, Kosten 160, Kurs 170 -> raw 10/Stück (stpfl. 7). FSA verbraucht (genutzt 2025|A = 1000).
const altbestand = ({ g, check, near }) => {
  const plan = g('planNetSale'), rate = 0.26375;
  const X = (cost = 150, alt = { price: 150, gainPS: 50, pre2009: true }, buyDate = '2005-01-03', shares = 100) =>
    ({ id: 1, depot: 'A', security: 'X', buyDate, shares, cost, origCost: 100, vpCum: 0, divPS: {}, alt });
  const Y = lot(2, 'Y', '2020-01-01', 100, 160);
  // 1) Bank-Quote: X 14·r/(170−14·r) > Y 7·r/(170−7·r) – 0.4 nähme Y. Endgültig ist X frei (100k deckt raw 20·n) -> X zuerst.
  //    Bank-Steuer: n·14·r mit n = 1000 / (170 − 14·r) ≈ 6,01296; Netto = Bank-Auszahlung (Erstattung nicht im Netto);
  //    Erstattung 100k: r · min(Bemessungsgrundlage 14·n, frei 20·n·0,7 = 14·n) = Bank-Steuer dieser Zeile
  let p = plan(res([X(), Y], { X: 170, Y: 170 }), data, SET, 2025, 1000);
  const nX = Math.ceil(1000 / (170 - 14 * rate) * 1e8) / 1e8;
  check('alt plan: pre-2009 lot picked before normal gain lot', p.rows.length === 1 && p.rows[0].lot.security === 'X' && near(p.rows[0].shares, nX, 2e-8), p.rows.map(r => [r.lot.security, r.shares]));
  check('alt plan: bank tax and net = bank payout', near(p.tax, nX * 14 * rate, 0.011) && p.net >= 1000 && p.net < 1000.01 && near(p.net, p.gross - p.fees - p.tax, 0.011), p);
  check('alt plan: refund100k = bank tax of the lot', near(p.refund100k, p.tax, 0.011) && p.refund100k > 21 && p.refundBfh === 0 && near(p.rows[0].refund, p.refund100k, 0.011), [p.refund100k, p.refundBfh, p.tax, p.rows[0].refund]);
  // Gewinn der Zeile = Neugewinn + Altgewinn vor TFS: n·(20 + 50) (0.4-Formel: n·20)
  check('alt plan: row gain includes old-law gain', near(p.rows[0].gain, nX * 70, 0.011), p.rows[0].gain);
  // 2) Rest 100 (Bescheid): deckt nur 100 von raw ≈ 120,26 – Quote 14·(1 − 100/120,26) ≈ 2,36 < 7 -> weiterhin X;
  //    Erstattung r · min(14·n ≈ 84,18, 100·0,7 = 70) = 70·r = 18,46
  p = plan(res([X(), Y], { X: 170, Y: 170 }), data, { ...SET, altFb: { '2025|A': 100 } }, 2025, 1000);
  check('alt plan B2: left 100 covers the step after TFS (84,18) fully', p.rows[0].lot.security === 'X' && near(p.refund100k, p.tax, 0.011) && near(p.rows[0].refund, p.refund100k, 0.001), [p.rows.map(r => r.lot.security), p.refund100k, p.tax]);
  // B2: Rest 50 deckt 50 von 84,18 nach TFS – Quote 14·(1 − 50/84,18) ≈ 5,68 < 7 -> X; Erstattung 50·r
  p = plan(res([X(), Y], { X: 170, Y: 170 }), data, { ...SET, altFb: { '2025|A': 50 } }, 2025, 1000);
  check('alt plan B2: partly covered step, refund capped by left', p.rows[0].lot.security === 'X' && near(p.refund100k, round2(50 * rate), 0.001) && near(p.rows[0].refund, p.refund100k, 0.001), [p.rows.map(r => r.lot.security), p.refund100k]);
  // 3) Rest 50: 14·(1 − 50/120,26) ≈ 8,18 > 7 -> normal, Y zuerst (Y deckt das Ziel); keine Erstattung
  p = plan(res([X(), Y], { X: 170, Y: 170 }), data, { ...SET, altFb: { '2025|A': 30 } }, 2025, 1000); // 14·(1 − 30/84,18) ≈ 9,01 > 7
  check('alt plan: small left -> normal choice (Y first)', p.rows.length === 1 && p.rows[0].lot.security === 'Y' && p.refund100k === 0 && p.rows[0].refund === 0, [p.rows.map(r => r.lot.security), p.refund100k]);
  // 4) Freibetrag verbraucht (Bescheid 0): X wie jeder andere Lot -> Y zuerst
  p = plan(res([X(), Y], { X: 170, Y: 170 }), data, { ...SET, altFb: { '2025|A': 0 } }, 2025, 1000);
  check('alt plan: left 0 -> Y first, no refund', p.rows[0].lot.security === 'Y' && p.refund100k === 0, [p.rows.map(r => r.lot.security), p.refund100k]);
  // 5) FSA frei: X n = 1000/170 ≈ 5,88, stpfl. 82,35 < FSA -> Bank-Steuer 0, Erstattung gekappt auf besteuerte Grundlage 0
  p = plan(res([X(), Y], { X: 170, Y: 170 }), data, { ...SET, genutzt: {} }, 2025, 1000);
  check('alt plan: refund capped by taxed base (FSA free)', p.rows[0].lot.security === 'X' && p.tax === 0 && p.refund100k === 0 && p.rows[0].refund === 0, [p.rows.map(r => r.lot.security), p.tax, p.refund100k]);
  // 6) Review Focus 4: X vor 2009 mit Verlust nach 2018 (Kurs 140: raw −10/Stück) -> Quote 0 wie ein Verlust-Lot,
  //    kein 100k-Posten, keine Erstattung; Verlust ohne Gewinne im Jahr -> Steuer 0
  p = plan(res([X(), Y], { X: 140, Y: 170 }), data, SET, 2025, 1000);
  check('alt plan F4: pre-2009 loss lot -> no refund, chosen like a loss lot', p.rows.length === 1 && p.rows[0].lot.security === 'X' && p.tax === 0
    && p.refund100k === 0 && p.refundBfh === 0 && p.rows[0].refund === 0, [p.rows.map(r => r.lot.security), p.tax, p.refund100k, p.refundBfh]);
  // Final review M1: Gleichstand (Quote 0) zwischen X (vor 2009, 100k deckt den Gewinn, die Bank zieht aber Steuer ab) und
  // Verlust-Lot Z (2021, Kosten 200, Kurs 170) bei verbrauchtem FSA -> geringere Bank-Steuer je Euro netto zuerst: Z, Steuer 0
  p = plan(res([X(), lot(3, 'Y', '2021-01-01', 100, 200)], { X: 170, Y: 170 }), data, SET, 2025, 2000);
  check('alt plan M1: tie broken by bank tax -> loss lot before pre-2009 lot', p.rows[0].lot.security === 'Y' && p.rows[0].tax === 0, p.rows.map(r => [r.lot.security, r.tax]));
  // 7) Lot 2015 (Altgewinn 50 steuerpflichtig), Kurs 120 -> raw −30/Stück, 10 Stück (Ziel unerreichbar):
  //    Plan-Event 10·(−30·0,7 + 50) = 290 -> Steuer 290·r = 76,49; BFH: F = min(30·10, 50·10) = 300, Posten 300·0,3 = 90,
  //    Erstattung r · min(besteuert 290, 90) = 23,74; Gewinn der Zeile 10·(−30 + 50) = 200
  p = plan(res([X(150, { price: 150, gainPS: 50, pre2009: false }, '2015-03-02', 10)], { X: 120 }), data, SET, 2025, 1e6);
  check('alt plan: 2009-2017 lot event incl. old-law gain', p.rows.length === 1 && near(p.rows[0].shares, 10, 1e-8) && near(p.tax, round2(290 * rate), 0.001), p.rows[0]);
  check('alt plan: BFH refund from plan row', near(p.refundBfh, round2(90 * rate), 0.001) && p.refund100k === 0 && near(p.rows[0].refund, p.refundBfh, 0.001), [p.refundBfh, p.refund100k, p.rows[0].refund]);
  check('alt plan: 2009-2017 row gain = new + old gain', near(p.rows[0].gain, 200, 0.001), p.rows[0].gain);
};
const round2 = x => Math.round(x * 100) / 100;
// Minor 1: die Suche akzeptiert n nur, wenn auch das gerundete Netto der Zeile (Gebühr und Steuer auf Cent) reicht –
// sonst fehlt 1 ct und eine Staubzeile (~0,0001 Stück für 0,01 €) folgt
const dust = ({ g, check }) => {
  const S = { ...SET, genutzt: { '2025|A': 1000 }, gebuehrFix: 4.9, gebuehrProz: 0.25 };
  const L = [lot(1, 'X', '2019-01-01', 3, 61.37), lot(2, 'X', '2020-01-01', 7, 88.11), lot(3, 'X', '2021-01-01', 12.5, 97.4), lot(4, 'Y', '2019-03-01', 20, 33.3), lot(5, 'Y', '2022-01-01', 15, 140.2)];
  const bad = [];
  for (const prices of [{ X: 123.45, Y: 77.77 }, { X: 101.13, Y: 151.9 }, { X: 99.99, Y: 45.67 }]) for (let t = 2990; t <= 3010; t++) {
    const p = g('planNetSale')(res(L, prices), data, S, 2025, t);
    if (!p.reached || p.net < t || p.rows.some(r => r.gross < 0.5)) bad.push([t, prices.X, p.net, p.rows.filter(r => r.gross < 0.5).map(r => r.shares)]);
  }
  check('plan minor 1: no dust rows, net >= target (2990..3010)', bad.length === 0, bad);
};
// Final review M3: Laufzeit linear in der Planlänge (Plan-Events je Bank laufend zusammengefasst)
// Grenze 3 s für langsamere CI-Runner: linear ~0,6 s, die alte quadratische Version brauchte lokal 3,6–4,9 s
const timing = ({ g, check }) => {
  const secs = [], lots = [], prices = {};
  for (let s = 0; s < 30; s++) {
    secs.push({ uuid: 'S' + s, name: 'S' + s, isin: 'I' + s, currency: 'EUR' }); prices['S' + s] = 100;
    for (let i = 0; i < 100; i++) lots.push(lot(s * 1000 + i, 'S' + s, `2020-01-${String(1 + i % 28).padStart(2, '0')}`, 1, 40 + (i * 7 + s * 3) % 120));
  }
  const t0 = performance.now();
  const p = g('planNetSale')(res(lots, prices), { ...data, securities: secs }, { ...SET, genutzt: {}, gebuehrFix: 5 }, 2025, 1e9);
  const ms = performance.now() - t0;
  check('plan M3: 30 securities x 100 lots, unreachable, < 3 s', !p.reached && p.rows.length === 3000 && ms < 3000, Math.round(ms));
};
