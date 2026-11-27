// Baut dist/index.html: eine einzige Datei ohne externe Anfragen.
// ECharts und Schriftarten werden eingebettet. Aufruf: node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE } from './files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = p => readFileSync(join(root, p), 'utf8');
const pkg = JSON.parse(rd('package.json'));
const version = process.env.VERSION || pkg.version;

const engine = ENGINE.map(f => rd(`src/${f}.js`)).join('\n');

const fonts = [
  ['Public Sans', 400, 'public-sans-latin-400-normal'], ['Public Sans', 500, 'public-sans-latin-500-normal'],
  ['Public Sans', 600, 'public-sans-latin-600-normal'], ['Public Sans', 700, 'public-sans-latin-700-normal'],
  ['JetBrains Mono', 400, 'jetbrains-mono-latin-400-normal'], ['JetBrains Mono', 500, 'jetbrains-mono-latin-500-normal'],
  ['JetBrains Mono', 600, 'jetbrains-mono-latin-600-normal'],
].map(([fam, w, file]) => {
  const b64 = readFileSync(join(root, 'fonts', file + '.woff2')).toString('base64');
  return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
}).join('\n');

// </script> im eingebetteten Code darf das Script-Tag nicht schließen
const safe = js => js.replace(/<\/script/gi, '<\\/script');
const head = `<style>\n${fonts}\n</style>\n<script>\n${safe(rd('vendor/echarts.min.js'))}\n</script>`;

// Ersetzt needle genau einmal (Funktion als Ersatz, damit $-Muster im Code nicht greifen).
// Fehlt needle, bricht der Build ab, statt eine kaputte Seite auszuliefern.
const sub = (page, needle, repl) => {
  if (!page.includes(needle)) throw new Error('Platzhalter fehlt: ' + needle);
  return page.replace(needle, () => repl);
};

// Kleine Platzhalter zuerst, Engine und UI zuletzt: so trifft nie eingebetteter Code einen Platzhalter.
let page = rd('src/page.html');
for (const ph of ['{{TITLE}}', '{{VERSION}}']) if (!page.includes(ph)) throw new Error('Platzhalter fehlt: ' + ph);
page = page.replaceAll('{{TITLE}}', 'Steuerschätzer für Portfolio Performance');
page = page.replaceAll('{{VERSION}}', version);
page = sub(page, '{{HEAD}}', head);
page = sub(page, '/*ENGINE*/', safe(engine));
page = sub(page, '/*UI*/', safe(rd('src/ui.js')));

const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data: blob:";
const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page}
</body>
</html>
`;
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'index.html'), html);
console.log(`dist/index.html gebaut (Version ${version}, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
