// Einstellungen im Browser speichern. Nie Buchungen, Kurse oder Lots – nur Steuer-Einstellungen und Fondstypen je ISIN.
const STORE_KEY = 'pp-steuerschaetzer-v1';
const SETTINGS_KEYS = ['veranlagung', 'kirchensteuer', 'bundesland', 'genutzt', 'fundTypes', 'gebuehrFix', 'gebuehrProz'];
const defaultSettings = () => ({ veranlagung: 'single', kirchensteuer: false, bundesland: 'default', genutzt: null, fundTypes: {}, gebuehrFix: 0, gebuehrProz: 0 });

function loadSettings(storage) {
  const s = defaultSettings();
  try {
    const raw = JSON.parse(storage.getItem(STORE_KEY) || '{}');
    for (const k of SETTINGS_KEYS) if (k in raw) s[k] = raw[k];
    if (!s.fundTypes || typeof s.fundTypes !== 'object') s.fundTypes = {};
  } catch { /* defekter Speicher: Standardwerte */ }
  return s;
}
function saveSettings(storage, s) {
  try { storage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(SETTINGS_KEYS.map(k => [k, s[k]])))); }
  catch { /* privater Modus / voll: nicht speichern */ }
}
