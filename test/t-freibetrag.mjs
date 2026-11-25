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
  // 2) Eingetragene FSA 600/400 -> A 12 Stück (600), B 8 Stück (400)
  r = opt(res([lot(1, '2020-01-01', 100, 50), lb], 100), two, { ...S2, fsa: { A: 600, B: 400 } }, 2025);
  check('fb: entered FSA per bank', r.pooled === false && near(r.banks[0].harvested, 600, 0.02) && near(r.banks[1].harvested, 400, 0.02)
    && r.rows.length === 2 && r.rows[0].bank === 'A' && r.rows[1].bank === 'B' && r.total === 1000, r);
  // 3) B ausgewählt, aber ohne Lots/Ereignisse/Topf: inaktiv, A bekommt den vollen Pauschbetrag
  r = opt(res([lot(1, '2020-01-01', 100, 50)], 100), two, S2, 2025);
  check('fb: inactive bank excluded', r.pooled === false && r.banks.length === 1 && r.banks[0].key === 'A' && near(r.harvested, 1000, 0.02) && r.total === 1000, r);
  // 4) Einzelaktie (Kauf 2015), Aktientopf 300: Ernte 300 + 1000 = 1300 (26 Stück), nur Aktientopf genutzt
  r = opt(res([lot(1, '2015-01-01', 100, 50)], 100, { income: [{ year: 2025, date: '2025-02-01', owner: 'A', kind: 'aktie', amount: -300 }] }), data(), { ...SET, fundTypes: { IS: 'einzelaktie' } }, 2025);
  check('fb: stock pot consumed by single-stock gains', near(r.harvested, 1300, 0.02) && near(r.banks[0].potsUsed.aktien, 300, 0.02) && r.banks[0].potsUsed.allg === 0, r.banks[0]);
};
