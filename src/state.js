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

// Neues Objekt mit Jahreswert je Bank (`Jahr|bankKey`, für genutzt und vortrag); null löscht.
// Einträge anderer Jahre fallen weg, damit der Speicher nicht wächst.
function setYearBank(obj, year, bankKey, value) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) if (k.startsWith(year + '|')) out[k] = v;
  if (value === null) delete out[`${year}|${bankKey}`]; else out[`${year}|${bankKey}`] = value;
  return out;
}
// Neues Objekt mit Eintrag je Schlüssel (fsa, bankOf, zinsen); null löscht.
function setKey(obj, key, value) {
  const out = { ...(obj || {}) };
  if (value === null) delete out[key]; else out[key] = value;
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
