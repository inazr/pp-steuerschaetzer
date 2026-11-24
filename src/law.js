// Gesetzliche Werte je Jahr. param(name, jahr) liefert den Wert des letzten Jahres <= jahr;
// Werte mit exact:true (Basiszins) müssen für genau dieses Jahr veröffentlicht sein.
const LAW = {
  basiszins: {
    exact: true,
    values: { 2018: 0.0087, 2019: 0.0052, 2020: 0.0007, 2021: -0.0045, 2022: -0.0005, 2023: 0.0255, 2024: 0.0229, 2025: 0.0253, 2026: 0.0320 },
    source: {
      2018: 'BMF-Schreiben Januar 2018 (nicht online gegengeprüft)',
      2019: 'BMF-Schreiben Januar 2019 (nicht online gegengeprüft)',
      2020: 'BMF-Schreiben vom 29.01.2020, BStBl I 2020, 218',
      2021: 'BMF-Schreiben vom 06.01.2021, BStBl I 2021, 56 (Wert nicht online gegengeprüft)',
      2022: 'BMF-Schreiben vom 07.01.2022',
      2023: 'BMF-Schreiben vom 04.01.2023',
      2024: 'BMF-Schreiben vom 05.01.2024',
      2025: 'BMF-Schreiben vom 10.01.2025, BStBl I 2025, 273',
      2026: 'BMF-Schreiben vom 13.01.2026, IV C 1 - S 1980/00230/012/001',
    },
  },
  sparerpauschbetrag: { values: { 2009: { single: 801, joint: 1602 }, 2023: { single: 1000, joint: 2000 } }, source: '§ 20 Abs. 9 EStG' },
  abgeltungssteuer: { values: { 2009: 0.25 }, source: '§ 32d Abs. 1 EStG' },
  soli: { values: { 2009: 0.055 }, source: '§ 4 SolZG' },
  kirchensteuer: { values: { 2009: { bayern: 0.08, baden_wuerttemberg: 0.08, default: 0.09 } }, source: 'Kirchensteuergesetze der Länder' },
  vpFaktor: { values: { 2018: 0.7 }, source: '§ 18 Abs. 1 InvStG' },
};

function param(name, year) {
  const p = LAW[name];
  if (p.exact) {
    if (!(year in p.values)) throw new Error(`Kein Wert für ${name} ${year}`);
    return p.values[year];
  }
  let best = null;
  for (const y of Object.keys(p.values)) if (+y <= year && (best === null || +y > best)) best = +y;
  if (best === null) throw new Error(`Kein Wert für ${name} ${year}`);
  return p.values[best];
}
const hasParam = (name, year) => { try { param(name, year); return true; } catch { return false; } };

// Abgeltungsteuer + Soli (+ Kirchensteuer mit Ermäßigung nach § 32d Abs. 1 S. 3 EStG)
function taxRate(settings, year) {
  const e = param('abgeltungssteuer', year), s = param('soli', year);
  if (!settings.kirchensteuer) return e + e * s;
  const kt = param('kirchensteuer', year), k = kt[settings.bundesland] ?? kt.default;
  const eff = e / (1 + k * e);
  return eff + eff * s + eff * k;
}

const FUND_TYPES = {
  aktienfonds: { label: 'Aktienfonds', tfs: 0.30, vp: true },
  mischfonds: { label: 'Mischfonds', tfs: 0.15, vp: true },
  immo_inland: { label: 'Immobilienfonds (Inland)', tfs: 0.60, vp: true },
  immo_ausland: { label: 'Immobilienfonds (Ausland)', tfs: 0.80, vp: true },
  sonstige: { label: 'Sonstiger Fonds', tfs: 0, vp: true },
  einzelaktie: { label: 'Einzelaktie', tfs: 0, vp: false, bestandsschutz: '2009-01-01' },
};
