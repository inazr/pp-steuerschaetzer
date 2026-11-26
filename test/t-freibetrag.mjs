const SET = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: {}, fundTypes: {}, depots: ['A'], bankOf: {}, fsa: {}, vortrag: {}, zinsen: {} };
const data = (isin = 'IS') => ({ securities: [{ uuid: 'S', name: 'ETF', isin, wkn: '', currency: 'EUR' }], portfolios: [{ uuid: 'A', name: 'A' }], accounts: [], interest: [], txs: [], dividends: [], prices: new Map(), warnings: [] });
const lot = (id, buyDate, shares, cost, vpCum = 0) => ({ id, depot: 'A', security: 'S', buyDate, shares, cost, vpCum, divPS: {} });
const res = (lots, price, extra = {}) => ({ lots, vpRows: [], income: [], vpForecast: [], errors: [], warnings: [], realized: {}, latest: new Map([['S', ['2025-11-20', price]]]), ...extra });

export default ({ g, check, near }) => {
  const opt = g('optimizeAllowance');

  // FIFO: der jüngere, profitablere Lot kommt erst nach dem älteren
  let r = opt(res([lot(1, '2020-01-01', 10, 100), lot(2, '2021-01-01', 100, 50)], 120), data(), SET, 2025);
  check('fb: totals', r.total === 1000 && r.used === 0 && r.remaining === 1000, r);
  check('fb: oldest lot first, fully', r.rows[0].lot.id === 1 && near(r.rows[0].shares, 10, 1e-9) && near(r.rows[0].gainTaxable, 140), r.rows[0]);
  check('fb: then younger lot partially', r.rows[1].lot.id === 2 && near(r.rows[1].shares, Math.floor(860 / 49 * 1e8) / 1e8, 1e-9), r.rows[1]);
  check('fb: never exceeds allowance', r.harvested <= 1000 && r.harvested > 999.9, r.harvested);

  // 1000 € frei, 50 €/Stück steuerpflichtig (Sonstiger Fonds, TFS 0) -> 20 Stück
  r = opt(res([lot(1, '2020-01-01', 100, 50)], 100), data(), { ...SET, fundTypes: { IS: 'sonstige' } }, 2025);
  check('fb: 20 shares', r.rows.length === 1 && near(r.rows[0].shares, 20, 1e-9) && near(r.rows[0].gross, 2000), r.rows);

  // VP-Anrechnung mindert den Gewinn
  r = opt(res([lot(1, '2020-01-01', 100, 50, 1000)], 100), data(), { ...SET, fundTypes: { IS: 'sonstige' } }, 2025);
  check('fb: vpCum reduces gain per share (40)', near(r.rows[0].shares, 25, 1e-9), r.rows);

  // Verlust-Lot an der Spitze blockiert die Queue
  r = opt(res([lot(1, '2020-01-01', 10, 150), lot(2, '2021-01-01', 10, 50)], 120), data(), SET, 2025);
  check('fb: loss head blocks queue', r.rows.length === 0 && r.harvested === 0, r.rows);

  // Bestandsschutz-Lot (Einzelaktie vor 2009) an der Spitze blockiert ebenfalls
  r = opt(res([lot(1, '2005-01-01', 10, 10), lot(2, '2015-01-01', 10, 50)], 120), data(), { ...SET, fundTypes: { IS: 'einzelaktie' } }, 2025);
  check('fb: Bestandsschutz head blocks queue', r.rows.length === 0, r.rows);

  // Kein Kurs -> nichts
  r = opt({ ...res([lot(1, '2020-01-01', 10, 50)], 0), latest: new Map() }, data(), SET, 2025);
  check('fb: no price -> no rows', r.rows.length === 0);

  // Override „genutzt“ je Bank
  const rr = res([lot(1, '2020-01-01', 1, 100)], 100);
  r = opt(rr, data(), { ...SET, genutzt: { '2025|A': 434.95 } }, 2025);
  check('fb: genutzt override -> used', near(r.used, 434.95) && near(r.remaining, 565.05), r);
  check('fb: joint SPB 2000', opt(rr, data(), { ...SET, veranlagung: 'joint' }, 2025).total === 2000);

  // allgemeiner Topf 300 wird vor dem FSA verbraucht: Ernte = 300 + 1000
  r = opt(res([lot(1, '2020-01-01', 100, 50)], 100, { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'sonst', amount: -300 }] }), data(), { ...SET, fundTypes: { IS: 'sonstige' } }, 2025);
  check('fb: general pot consumed before FSA', near(r.harvested, 1300, 0.02) && near(r.banks[0].potsUsed.allg, 300, 0.02) && r.banks[0].hint, r.banks[0]);
  check('fb: fsaUsed per bank excludes pot share', near(r.banks[0].fsaUsed, 1000, 0.02), r.banks[0]);
  // Aktientopf wird von Fondsgewinnen nicht berührt
  r = opt(res([lot(1, '2020-01-01', 100, 50)], 100, { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'aktie', amount: -300 }] }), data(), { ...SET, fundTypes: { IS: 'sonstige' } }, 2025);
  check('fb: stock pot untouched by fund gains', near(r.harvested, 1000, 0.02) && r.banks[0].potsUsed.aktien === 0, r.banks[0]);

  // Zwei Depots A, B; Lot je 100 Stück, Einstand 50, Kurs 100, Sonstiger Fonds (TFS 0) -> 50 EUR stpfl. Gewinn je Stück
  const two = { ...data(), portfolios: [{ uuid: 'A', name: 'A' }, { uuid: 'B', name: 'B' }] };
  const lb = { ...lot(2, '2020-01-01', 100, 50), depot: 'B' };
  const S2 = { ...SET, depots: ['A', 'B'], fundTypes: { IS: 'sonstige' } };
  // 1) Gemeinsamer Modus (kein FSA-Eintrag): gemeinsamer Topf 1000 -> A erntet 20 Stück = 1000, B nichts mehr
  r = opt(res([lot(1, '2020-01-01', 100, 50), lb], 100), two, S2, 2025);
  check('fb: pooled shares one allowance', r.pooled === true && near(r.harvested, 1000, 0.02) && r.total === 1000 && r.used === 0 && r.remaining === 1000
    && r.banks.length === 2 && near(r.banks[0].harvested + r.banks[1].harvested, 1000, 0.02), r);
  // Final review M1: A verbraucht den gemeinsamen Topf, B startet mit 0 (Hinweis „ausgeschöpft“ statt „keine Lots“)
  check('fb M1: pooled leftStart per bank', near(r.banks[0].leftStart, 1000) && r.banks[1].leftStart === 0 && r.banks[1].rows.length === 0, r.banks);
  // Minor 10: gemeinsamer Modus, genutzt-Overrides zusammen über spb – used bleibt ohne eigene Kappung beim spb
  r = opt(res([lot(1, '2020-01-01', 100, 50), lb], 100), two, { ...S2, genutzt: { '2025|A': 700, '2025|B': 600 } }, 2025);
  check('fb minor 10: pooled used never above spb', r.pooled === true && r.used === 1000 && r.remaining === 0, r);
  // 2) Eingetragene FSA 600/400 -> A 12 Stück (600), B 8 Stück (400)
  r = opt(res([lot(1, '2020-01-01', 100, 50), lb], 100), two, { ...S2, fsa: { A: 600, B: 400 } }, 2025);
  check('fb: entered FSA per bank', r.pooled === false && near(r.banks[0].harvested, 600, 0.02) && near(r.banks[1].harvested, 400, 0.02)
    && r.rows.length === 2 && r.rows[0].bank === 'A' && r.rows[1].bank === 'B' && r.total === 1000, r);
  check('fb: fsaUsed per entered bank', near(r.banks[0].fsaUsed, 600, 0.02) && near(r.banks[1].fsaUsed, 400, 0.02), r.banks);
  // 3) B ausgewählt, aber ohne Lots/Ereignisse/Topf: inaktiv, A bekommt den vollen Pauschbetrag
  r = opt(res([lot(1, '2020-01-01', 100, 50)], 100), two, S2, 2025);
  check('fb: inactive bank excluded', r.pooled === false && r.banks.length === 1 && r.banks[0].key === 'A' && near(r.harvested, 1000, 0.02) && r.total === 1000, r);
  // 4) Einzelaktie (Kauf 2015), Aktientopf 300: Ernte 300 + 1000 = 1300 (26 Stück), nur Aktientopf genutzt
  r = opt(res([lot(1, '2015-01-01', 100, 50)], 100, { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'aktie', amount: -300 }] }), data(), { ...SET, fundTypes: { IS: 'einzelaktie' } }, 2025);
  check('fb: stock pot consumed by single-stock gains', near(r.harvested, 1300, 0.02) && near(r.banks[0].potsUsed.aktien, 300, 0.02) && r.banks[0].potsUsed.allg === 0, r.banks[0]);
  // v0.5 §4a: Fonds-Lot vor 2009 (X: Kosten ab 2018 = 150, Kurs 170 -> stpfl. 14/Stück) wäre ohnehin über den
  // 100.000-€-Freibetrag frei -> übersprungen, solange dieser frei ist; geerntet wird Lot 2020 (Y: Kosten 160 -> stpfl. 7/Stück):
  // floor8(1000 / 7) = 142,85714285 Stück. 0.4 nähme X (höchster Gewinn je Stück): floor8(1000 / 14) = 71,42857142 Stück.
  const dXY = { ...data(), securities: [{ uuid: 'X', name: 'X', isin: 'IEX', currency: 'EUR' }, { uuid: 'Y', name: 'Y', isin: 'IEY', currency: 'EUR' }] };
  const lX = { id: 1, depot: 'A', security: 'X', buyDate: '2005-01-03', shares: 100, cost: 150, origCost: 100, vpCum: 0, divPS: {}, alt: { price: 150, gainPS: 50, pre2009: true } };
  const lY = { id: 2, depot: 'A', security: 'Y', buyDate: '2020-01-01', shares: 200, cost: 160, vpCum: 0, divPS: {} };
  const rXY = { ...res([lX, lY], 0), latest: new Map([['X', ['2025-11-20', 170]], ['Y', ['2025-11-20', 170]]]) };
  const SA = { ...SET, fundTypes: { IEX: 'aktienfonds', IEY: 'aktienfonds' } };
  r = opt(rXY, dXY, SA, 2025);
  check('fb alt: pre-2009 lot skipped while 100k free, 2020 lot harvested', r.rows.length === 1 && r.rows[0].lot.security === 'Y'
    && near(r.rows[0].shares, Math.floor(1000 / 7 * 1e8) / 1e8, 1e-9) && near(r.harvested, 1000, 0.01), r.rows.map(x => [x.lot.security, x.shares]));
  // 100k verbraucht (Bescheid 0): X wie jeder andere Lot -> X zuerst (14 > 7)
  r = opt(rXY, dXY, { ...SA, altFb: { A: 0 } }, 2025);
  check('fb alt: 100k used up -> pre-2009 lot harvested normally', r.rows[0].lot.security === 'X' && near(r.rows[0].shares, Math.floor(1000 / 14 * 1e8) / 1e8, 1e-9), r.rows.map(x => [x.lot.security, x.shares]));
};
