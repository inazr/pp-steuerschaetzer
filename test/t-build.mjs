import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export default ({ check, root }) => {
  execFileSync('node', [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'pipe' });
  const p = join(root, 'dist/index.html');
  check('build: dist/index.html exists', existsSync(p));
  const html = readFileSync(p, 'utf8');
  check('build: ECharts 6.1.0 inlined', html.includes('6.1.0') && html.includes('echarts'));
  check('build: 7 embedded fonts', (html.match(/@font-face\{[^}]*data:font\/woff2;base64,/g) || []).length === 7);
  check('build: CSP forbids network', /http-equiv="Content-Security-Policy"[^>]*default-src 'none'/.test(html));
  check('build: no external src/href', !/(src|href)="https?:/i.test(html));
  check('build: lang de', html.includes('<html lang="de">'));
  check('build: project name', html.includes('<title>Steuerschätzer für Portfolio Performance</title>') && !/pp-steuern|PP-Steuern/.test(html));
  // ui.js hat keine Unit-Tests: jedes Inline-Skript muss wenigstens syntaktisch gültig sein
  const bad = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => { try { new vm.Script(m[1]); return null; } catch (e) { return e.message; } }).filter(Boolean);
  check('build: inline scripts parse', bad.length === 0, bad);
  // 0.6: binäre und verschlüsselte Dateien werden gelesen, verschlüsselte nach Passwortabfrage
  check('build: no "save as XML" hint', !html.includes('Speichern unter → XML') && !html.includes('binär oder verschlüsselt). Bitte'));
  const empty = (html.match(/<section class="panel" id="empty">[\s\S]*?<\/section>/) || [''])[0];
  check('build: empty state names formats', empty.includes('XML, binär oder verschlüsselt'));
  check('build: password field', /<input[^>]*type="password"[^>]*autocomplete="off"/.test(html) || /<input[^>]*autocomplete="off"[^>]*type="password"/.test(html));
  check('build: error texts', html.includes('Passwort falsch') && html.includes('Die Datei ist beschädigt oder ihr Format wird nicht unterstützt.') && !html.includes('Dieses Dateiformat wird nicht unterstützt.'));
  check('build: insecure-context text', html.includes('Entschlüsseln ist hier nicht möglich (unsicherer Kontext). Bitte die Datei lokal öffnen oder über https.'));
  check('build: version stamped', html.includes(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version));
};
