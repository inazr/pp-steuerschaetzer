// Einstellungen im Browser speichern. Nie Buchungen, Kurse oder Lots – nur Steuer-Einstellungen, Fondstypen je ISIN,
// abgewählte Depots (nur UUIDs) und Bankzuordnung, Freistellungsaufträge und Überschreibungen je Bank.
const STORE_KEY = 'pp-steuerschaetzer-v1';
const SETTINGS_KEYS = ['veranlagung', 'kirchensteuer', 'bundesland', 'genutzt', 'fundTypes', 'gebuehrFix', 'gebuehrProz', 'depotsOff', 'bankOf', 'fsa', 'vortrag', 'zinsen', 'settingsVersion'];
const defaultSettings = () => ({ veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: {}, fundTypes: {}, gebuehrFix: 0, gebuehrProz: 0, depotsOff: [], bankOf: {}, fsa: {}, vortrag: {}, zinsen: {} });
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

function loadSettings(storage) {
  const s = defaultSettings();
  try {
    const raw = JSON.parse(storage.getItem(STORE_KEY) || '{}');
    for (const k of SETTINGS_KEYS) if (k in raw) s[k] = raw[k];
  } catch { /* defekter Speicher: Standardwerte */ }
  if (!isObj(s.fundTypes)) s.fundTypes = {};
  // bis 0.2 eine Zahl ohne Jahr, bis 0.3 Schlüssel `Jahr|Depots`: keiner Bank zuordenbar, verwerfen
  if (!isObj(s.genutzt) || !(s.settingsVersion >= 4)) s.genutzt = {};
  s.settingsVersion = 4;
  for (const k of ['bankOf', 'fsa', 'vortrag', 'zinsen']) if (!isObj(s[k])) s[k] = {};
  if (!Array.isArray(s.depotsOff)) s.depotsOff = [];
  return s;
}
function saveSettings(storage, s) {
  try { storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SETTINGS_KEYS.map(k => [k, s[k]])))); }
  catch { /* privater Modus / voll: nicht speichern */ }
}

// Neues Objekt mit Jahreswert je Bank (`Jahr|bankKey`, für genutzt); null löscht.
// Einträge anderer Jahre fallen weg, damit der Speicher nicht wächst.
function setYearBank(obj, year, bankKey, value) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (k.startsWith(year + '|')) out[k] = v;
  if (value === null) delete out[`${year}|${bankKey}`]; else out[`${year}|${bankKey}`] = value;
  return out;
}
// Wie setYearBank, behält aber alle anderen Jahre (vortrag: Einträge früherer Jahre wirken auf die Fortschreibung).
function setYearBankKeep(obj, year, bankKey, value) {
  return setKey(obj, `${year}|${bankKey}`, value);
}
// Vortrag zum 1.1. je Feld ('aktien' | 'allg'): gespeichert wird nur, was eingetippt ist (sonst null = berechnet);
// ohne eingetipptes Feld fällt der Eintrag weg. Alle anderen Jahre bleiben (wie setYearBankKeep).
function setVortragField(obj, year, bankKey, field, value) {
  const cur = (obj || {})[`${year}|${bankKey}`], e = { aktien: null, allg: null };
  for (const f of ['aktien', 'allg']) if (cur && typeof cur[f] === 'number') e[f] = cur[f];
  e[field] = value;
  return setYearBankKeep(obj, year, bankKey, e.aktien === null && e.allg === null ? null : e);
}
// Neues Objekt mit Eintrag je Schlüssel (fsa, bankOf, zinsen); null löscht.
function setKey(obj, key, value) {
  const out = { ...(obj || {}) };
  if (value === null) delete out[key]; else out[key] = value;
  return out;
}

// Bank-Zuordnung (bankOf) ohne Ketten: Ziele sind immer Gründer. Wird X einer Bank T zugeordnet, folgen alle, die
// X zugeordnet waren, mit zu T; „eigene Bank“ (null oder X selbst) löscht nur den Eintrag von X.
// Zur Auswahl stehen nur Banken der aktuellen Ansicht, T ist also Gründer: ein Eintrag von T ist veraltet (zeigt auf ein
// Depot, das hier keine Bank gründet, s. founder() in bankMembers) und fällt weg – sonst wanderte T später ab, ohne X.
function assignBank(bankOf, member, target) {
  if (!target || target === member) return setKey(bankOf, member, null);
  const out = {};
  for (const [k, v] of Object.entries(bankOf || {})) out[k] = v === member ? target : v;
  delete out[target];
  out[member] = target;
  return out;
}

// Depotauswahl: gespeichert werden die abgewählten UUIDs, damit neue Depots automatisch an sind
function selectedDepots(settings, fileUuids) {
  const off = new Set(settings.depotsOff || []), on = fileUuids.filter(u => !off.has(u));
  return on.length ? on : [...fileUuids];
}
// Abgewählte dieser Datei plus gespeicherte UUIDs anderer Dateien
function nextDepotsOff(settings, fileUuids, checked) {
  const inFile = new Set(fileUuids), on = new Set(checked);
  return [...(settings.depotsOff || []).filter(u => !inFile.has(u)), ...fileUuids.filter(u => !on.has(u))];
}

// Geratene Fondstypen der übergebenen Wertpapiere als explizite Wahl übernehmen; vorhandene Wahl bleibt
function confirmFundTypes(settings, secs) {
  const out = { ...(settings.fundTypes || {}) };
  for (const s of secs) if (fundTypeGuessed(settings, s)) out[s.isin || s.uuid] = guessFundType(s);
  return out;
}
