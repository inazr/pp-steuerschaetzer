// Gesetzliche Werte je Jahr. param(name, jahr) liefert den Wert des letzten Jahres <= jahr;
// Werte mit exact:true (Basiszins) müssen für genau dieses Jahr veröffentlicht sein.
const LAW = {
  basiszins: {
    exact: true,
    values: { 2018: 0.0087, 2019: 0.0052, 2020: 0.0007, 2021: -0.0045, 2022: -0.0005, 2023: 0.0255, 2024: 0.0229, 2025: 0.0253, 2026: 0.0320 },
    source: {
      2018: 'BMF-Schreiben vom 04.01.2018, BStBl I 2018, S. 249',
      2019: 'BMF-Schreiben vom 09.01.2019, BStBl I 2019, S. 58',
      2020: 'BMF-Schreiben vom 29.01.2020, BStBl I 2020, 218',
      2021: 'BMF-Schreiben vom 06.01.2021, BStBl I 2021, S. 56',
      2022: 'BMF-Schreiben vom 07.01.2022',
      2023: 'BMF-Schreiben vom 04.01.2023',
      2024: 'BMF-Schreiben vom 05.01.2024, BStBl I 2024, S. 154',
      2025: 'BMF-Schreiben vom 10.01.2025, BStBl I 2025, 273',
      2026: 'BMF-Schreiben vom 13.01.2026, BStBl I 2026, S. 155',
    },
    // Ältere BMF-Schreiben stehen nicht mehr auf bundesfinanzministerium.de; dann Wiedergabe bei Haufe bzw. Otto Schmidt
    url: {
      2018: 'https://www.haufe.de/id/beitrag/investmentfonds-223-vorabpauschale-HI11762300.html',
      2019: 'https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gem-18-abs-4-invstg-HI12617630.html',
      2020: 'https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gemaess-18-abs-4-invstg-HI13687798.html',
      2021: 'https://www.otto-schmidt.de/news/steuerrecht/alle-weiteren-zuletzt-veroffentlichten-bmf-schreiben-2021-01-08.html',
      2022: 'https://www.otto-schmidt.de/news/steuerrecht/basiszins-zur-berechnung-der-vorabpauschale-gemass-18-absatz-4-invstg-2022-01-13.html',
      2023: 'https://www.haufe.de/id/rechtsquelle/basiszins-zur-berechnung-der-vorabpauschale-gemaess-18-absatz-4-invstg-basiszins-zum-2-januar-2023-HI15518934.html',
      2024: 'https://www.otto-schmidt.de/news/steuerrecht/basiszins-zur-berechnung-der-vorabpauschale-gemass-18-absatz-4-invstg-2024-01-11.html',
      2025: 'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Investmentsteuer/2025-01-10-basiszins-vorabpauschale-zum-2-1-2025.html',
      2026: 'https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Investmentsteuer/2026-01-13-basiszins-berechnung-vorabpauschale.html',
    },
  },
  sparerpauschbetrag: { values: { 2009: { single: 801, joint: 1602 }, 2023: { single: 1000, joint: 2000 } }, source: '§ 20 Abs. 9 EStG' },
  abgeltungssteuer: { values: { 2009: 0.25 }, source: '§ 32d Abs. 1 EStG' },
  soli: { values: { 2009: 0.055 }, source: '§ 4 SolZG' },
  kirchensteuer: { values: { 2009: { bayern: 0.08, baden_wuerttemberg: 0.08, default: 0.09 } }, source: 'Kirchensteuergesetze der Länder' },
  vpFaktor: { values: { 2018: 0.7 }, source: '§ 18 Abs. 1 InvStG' },
  // je Person; bei Zusammenveranlagung rechnet das Tool vereinfacht mit dem doppelten Betrag
  altFreibetrag: { values: { 2018: 100000 }, source: '§ 56 Abs. 6 S. 1 Nr. 2 InvStG' },
};
// Datum der letzten Prüfung der Rechtslage; bei jeder Prüfung der Werte unten mitziehen
const LAW_STAND = '2026-11-26';

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
  sonstiges_wp: { label: 'Sonstiges Wertpapier (ETC, Anleihe, Zertifikat)', tfs: 0, vp: false },
};

// Fondstyp raten: PP-Dateien kennen keinen Wertpapiertyp, Namen sind oft Broker-Kürzel („VANG FTSE AW USDD“).
// Stärkstes Signal ist das ISIN-Präfix IE/LU, außer der Name trägt eine Gesellschaftsform (Linde plc, ArcelorMittal S.A.).
const FT_ETC = /\b(ETC|ETN|Zertifikat|Certificate|Xetra-Gold|EUWAX Gold|Optionsschein|Turbo)\b|\bPhysical (\w+ )?(Gold|Silver|Metals?)\b/i;
const FT_FUND_WORD = /fonds|\b(ETF|UCITS|SICAV|Funds?|Index|Acc|Dist)\b|\b(Thes|Aussch)/i;
// Anbieter, Fondsmarken und Broker-Kürzel zählen nur ohne Gesellschaftsform (Amundi SA, Invesco Ltd sind Aktien)
const FT_PROVIDER = /\b(iShares|Xtrackers|Vanguard|VANG|Amundi|Lyxor|LYX\w*|ISHS\w*|SPDR|WisdomTree|Invesco|ComStage|Dimensional|DWS|Deka|Concentra|Fondak|Industria|hausInvest|grundbesitz|Carmignac|Comgest|Fidelity|Templeton|Flossbach|DJE|Acatis)\b|\b(ISH\.|XTR\.|AIS-)|Ökoworld/i;
const FT_UNION = /\bUni[A-Z][a-z]/; // Union-Investment-Fonds (UniGlobal, UniRak); groß/klein-genau, sonst träfe es Unilever
// „Corp“ vor „Bond/BD“ ist eine Unternehmensanleihe im Fondsnamen, keine Gesellschaftsform
const FT_COMPANY = /\b(plc|AG|SE|S\.A\.?|SA|S\.p\.A\.?|N\.V\.?|NV|Inc\.?|Corp\.?(?!\s*(Bonds?|BD)\b)|Corporation|Ltd\.?|Holdings?|Group|KGaA)(\b|$)/i;
// Bekannte Aktien mit irischer/luxemburgischer ISIN, deren Broker-Name oft keine Gesellschaftsform trägt (nur am Namensanfang)
const FT_IELU_STOCK = /^(Linde|Accenture|ArcelorMittal|Spotify|Medtronic|CRH|Eaton|Smurfit|Johnson Controls|Trane|Allegion|Aptiv|Seagate|STERIS|Willis Towers|Aon|Ryanair|Kerry|Kingspan|AIB|Bank of Ireland|Flutter|Glanbia|Aroundtown|SES|Eurofins|Tenaris|Millicom|Globant|InPost|Grand City|Shurgard)\b/i;
const FT_BOND_FUND = /anleihe|renten|geldmarkt|€\s?STR|\b(Bonds?|BD|Treasury|Govt|Government|Aggregate|Corporate|Corp|Money Market|Overnight|Ester)\b/i;
const FT_BOND_SINGLE = /anleihe|pfandbrief|\bAnl\.|\b(Bond|Note|Schatz\w*)\b/i;

function guessFundType(sec) {
  const name = (sec && sec.name) || '', isin = (sec && sec.isin) || '';
  if (FT_ETC.test(name)) return 'sonstiges_wp';
  const company = FT_COMPANY.test(name) || (/^(IE|LU)/.test(isin) && FT_IELU_STOCK.test(name));
  // Jersey: Rohstoff-ETCs (WisdomTree, Invesco); Jersey-Aktien tragen „plc“
  if (/^JE/.test(isin) && !company) return 'sonstiges_wp';
  const fund = FT_FUND_WORD.test(name) || (!company && (FT_PROVIDER.test(name) || FT_UNION.test(name) || /^(IE|LU)/.test(isin)));
  if (fund) return FT_BOND_FUND.test(name) ? 'sonstige' : 'aktienfonds';
  return FT_BOND_SINGLE.test(name) ? 'sonstiges_wp' : 'einzelaktie';
}

// ---------- Reiter „Gesetze & Annahmen“ ----------
// Status: G geltendes Recht, B beschlossen, E Entwurf, A Annahme/Vereinfachung des Tools
const LAW_STATUS = { G: 'geltendes Recht', B: 'beschlossen', E: 'Entwurf', A: 'Annahme des Tools' };
const GII = 'https://www.gesetze-im-internet.de/';
const LAW_URL = {
  estg20: GII + 'estg/__20.html', estg32d: GII + 'estg/__32d.html', estg43a: GII + 'estg/__43a.html', estg44a: GII + 'estg/__44a.html',
  estg51a: GII + 'estg/__51a.html', estg52: GII + 'estg/__52.html', solzg4: GII + 'solzg_1995/__4.html',
  invstg18: GII + 'invstg_2018/__18.html', invstg19: GII + 'invstg_2018/__19.html', invstg20: GII + 'invstg_2018/__20.html', invstg56: GII + 'invstg_2018/__56.html',
  bfh2223: 'https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202610013/',
};

// Zeilen mit Zahlen kommen aus LAW/FUND_TYPES/taxRate, damit Anzeige und Rechnung nicht auseinanderlaufen.
// Läuft erst zur Laufzeit (fmtPct/fmtDate stehen in format.js, das nach law.js geladen wird).
function lawRows(settings, year) {
  const pct = x => new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 3 }).format(x);
  const eur0 = x => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(x) + ' €';
  const row = (bereich, wert, status, norm, url = '') => ({ bereich, wert, status, norm, url });
  const joint = settings.veranlagung === 'joint';
  const bz = Object.entries(LAW.basiszins.values).sort((a, b) => b[0] - a[0])
    .map(([y, v]) => row('Basiszins', `${y}: ${fmtPct(v)}`, 'G', `§ 18 Abs. 4 InvStG; ${LAW.basiszins.source[y]}`, LAW.basiszins.url[y]));
  const ft = FUND_TYPES, tfs = k => `${ft[k].label} ${pct(ft[k].tfs)}`;
  const spbYears = Object.keys(LAW.sparerpauschbetrag.values).map(Number).sort((a, b) => a - b);
  const spbText = spbYears.map((y, i) => {
    const v = LAW.sparerpauschbetrag.values[y], to = spbYears[i + 1];
    return `${to ? `${y}–${to - 1}` : `ab ${y}`}: ${eur0(v.single)} / ${eur0(v.joint)} (zusammen)`;
  }).join('; ');
  const spb = param('sparerpauschbetrag', year)[joint ? 'joint' : 'single'];
  const kt = param('kirchensteuer', year), fb = param('altFreibetrag', year);
  return [
    ...bz,
    row('Vorabpauschale', `Basisertrag = Wert 01.01. × Basiszins × ${pct(param('vpFaktor', year))}, höchstens Wertsteigerung + Ausschüttungen, abzüglich Ausschüttungen; im Kaufjahr je vollem Monat vor dem Kauf ein Zwölftel weniger; fließt am ersten Werktag des Folgejahres zu`, 'G', '§ 18 InvStG', LAW_URL.invstg18),
    row('Teilfreistellung', `${tfs('aktienfonds')}, ${tfs('mischfonds')}, ${tfs('immo_inland')}, ${tfs('immo_ausland')}; gilt auch für Vorabpauschale und Verluste`, 'G', '§ 20 InvStG', LAW_URL.invstg20),
    row('Anrechnung der Vorabpauschale', 'Bereits versteuerte Vorabpauschalen mindern den Veräußerungsgewinn', 'G', '§ 19 Abs. 1 InvStG', LAW_URL.invstg19),
    row('FIFO', 'Bei Sammelverwahrung gelten die zuerst gekauften Anteile als zuerst verkauft (je Depot)', 'G', '§ 20 Abs. 4 S. 7 EStG', LAW_URL.estg20),
    row('Bestandsschutz Einzelaktien', `Kauf vor dem ${fmtDate(ft.einzelaktie.bestandsschutz)}: Kursgewinn steuerfrei`, 'G', '§ 52 Abs. 28 S. 11 EStG', LAW_URL.estg52),
    row('Sparerpauschbetrag', `${year}: ${eur0(spb)} (${joint ? 'Zusammenveranlagung' : 'Einzelveranlagung'}); ${spbText}`, 'G', LAW.sparerpauschbetrag.source, LAW_URL.estg20),
    row('Werbungskosten', 'Kein Abzug tatsächlicher Werbungskosten; Soll- und Negativzinsen mindern die Kapitalerträge nicht', 'G', '§ 20 Abs. 9 S. 1 EStG', LAW_URL.estg20),
    row('Abgeltungsteuer', pct(param('abgeltungssteuer', year)), 'G', LAW.abgeltungssteuer.source, LAW_URL.estg32d),
    row('Solidaritätszuschlag', `${pct(param('soli', year))} der Abgeltungsteuer`, 'G', LAW.soli.source, LAW_URL.solzg4),
    row('Kirchensteuer', `${pct(kt.bayern)} (Bayern, Baden-Württemberg), sonst ${pct(kt.default)}; mindert die Abgeltungsteuer (§ 32d Abs. 1 S. 3 EStG)`, 'G', '§ 51a EStG; Kirchensteuergesetze der Länder', LAW_URL.estg51a),
    row('Steuersatz (deine Einstellung)', `${year}: ${pct(taxRate(settings, year))}${settings.kirchensteuer ? ' mit Kirchensteuer' : ' ohne Kirchensteuer'}`, 'G', '§ 32d Abs. 1 EStG, § 4 SolZG, § 51a EStG', LAW_URL.estg32d),
    row('Verlusttöpfe', 'Je Bank: Aktienverluste nur gegen Aktiengewinne, übrige Verluste gegen alle positiven Erträge; Rest wird vorgetragen oder auf Antrag bescheinigt', 'G', '§ 43a Abs. 3 EStG', LAW_URL.estg43a),
    row('Freistellungsauftrag', 'Je Bank; zusammen höchstens der Sparerpauschbetrag', 'G', '§ 44a EStG', LAW_URL.estg44a),
    row('Altanteile (vor 2018 gekauft)', 'Fiktiver Verkauf zum 31.12.2017 und Neukauf zum 01.01.2018 zum letzten Kurs 2017; der Altgewinn wird erst beim tatsächlichen Verkauf versteuert', 'G', '§ 56 Abs. 2, 3 InvStG', LAW_URL.invstg56),
    row('Freibetrag Altanteile vor 2009', `Altgewinn bis 31.12.2017 steuerfrei; Gewinne ab 2018 steuerfrei bis ${eur0(fb)} je Person, Rest wird jährlich festgestellt; die Bank zieht zunächst Steuer ab, Erstattung über die Steuererklärung`, 'G', LAW.altFreibetrag.source, LAW_URL.invstg56),
    row('BFH: Teilfreistellung bei Verlusten aus Altanteilen', 'Beruht ein Verlust ab 2018 darauf, dass der Kurs 31.12.2017 über dem Einstand lag, wird er nicht um die Teilfreistellung gekürzt', 'G', 'BFH, Urteile vom 25.11.2025, VIII R 22/23 und VIII R 15/22', LAW_URL.bfh2223),
    row('Verlusttöpfe ab 2018', 'Töpfe werden erst ab 2018 aus der Datei fortgeschrieben; ältere Verluste als Vortrag zum 1.1. eintragen', 'A', 'Annahme des Tools'),
    row('Jahressaldo', 'Steuer je Bank als Jahressaldo statt in der Buchungsreihenfolge der Bank', 'A', 'Annahme des Tools'),
    row('Gemeinsamer Freibetrag', 'Ohne eingetragene Freistellungsaufträge wird der Sparerpauschbetrag gemeinsam über alle Banken gerechnet', 'A', 'Annahme des Tools'),
    row('Fondstyp', 'Steht nicht in der PP-Datei und wird aus Name und ISIN geraten, bis du ihn bestätigst', 'A', 'Annahme des Tools'),
    row('Altgewinn', 'Kurs 31.12.2017 − Einstand, ohne ausschüttungsgleiche Erträge aus der Zeit vor 2018', 'A', 'Annahme des Tools; § 56 Abs. 3 InvStG', LAW_URL.invstg56),
    row('Freibetrag Altanteile: Bemessung', `${eur0(fb)} werden auf den Gewinn vor Teilfreistellung angerechnet`, 'A', 'Annahme des Tools; § 56 Abs. 6 InvStG', LAW_URL.invstg56),
    row('Freibetrag Altanteile: Paare', `Bei Zusammenveranlagung gemeinsam ${eur0(2 * fb)} statt ${eur0(fb)} je Person für die eigenen Anteile`, 'A', 'Annahme des Tools; § 56 Abs. 6 InvStG', LAW_URL.invstg56),
    row('Erwartete Erstattungen', 'Vereinfacht: nur für das laufende Jahr bzw. die Planung, höchstens bis zur im Jahr besteuerten Bemessungsgrundlage; die Veranlagung wird nicht im Detail nachgebildet', 'A', 'Annahme des Tools'),
    row('BFH-Urteile: Anwendung', 'Anwendung durch BMF und Banken offen; das Tool rechnet die Bank-Sicht und zeigt die Differenz als erwartete Erstattung über die Veranlagung', 'A', 'Annahme des Tools; BFH VIII R 22/23', LAW_URL.bfh2223),
    row('Spiegelfall', 'Altverlust bis 2017 mit Neugewinn ab 2018: keine Nachforderung modelliert', 'A', 'Annahme des Tools'),
    row('Gold-ETCs', 'Gold-ETCs mit Lieferanspruch (steuerfrei nach einem Jahr) nicht abgebildet; Gewinn voll steuerpflichtig', 'A', 'Annahme des Tools'),
    row('Quellensteuer', 'Keine Anrechnung ausländischer Quellensteuer', 'A', 'Annahme des Tools'),
    row('Ehegatten', 'Keine ehegattenübergreifende Verlustverrechnung zum Jahresende', 'A', 'Annahme des Tools'),
  ];
}
