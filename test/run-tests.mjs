// Testlauf ohne Abhängigkeiten: Engine-Dateien in einen gemeinsamen vm-Kontext laden,
// dann jede test/t-*.mjs ausführen. Aufruf: node test/run-tests.mjs [filter]
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ENGINE } from '../scripts/files.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = vm.createContext({
  console, performance, TextDecoder, TextEncoder, DecompressionStream, CompressionStream,
  Blob, Response, Intl, Map, Set, Math, Date, JSON, Uint8Array, DataView, ArrayBuffer,
});
for (const f of ENGINE) {
  const p = join(root, 'src', f + '.js');
  if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: p });
}
// Zugriff auf globale Bindungen (auch const/let) der Engine
const g = name => vm.runInContext(name, ctx);

let pass = 0, fail = 0, skip = 0;
const check = (name, cond, info) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); }
};
const near = (a, b, tol = 0.005) => typeof a === 'number' && Math.abs(a - b) <= tol;
const skipped = why => { skip++; console.log('  skip ' + why); };

const filter = process.argv[2];
const files = readdirSync(join(root, 'test')).filter(f => /^t-.*\.mjs$/.test(f) && (!filter || f.includes(filter))).sort();
for (const f of files) {
  console.log(f);
  try {
    const mod = await import(pathToFileURL(join(root, 'test', f)).href);
    await mod.default({ g, check, near, skipped, root, ctx });
  } catch (e) { fail++; console.log('  ERROR ' + (e && e.stack || e)); }
}
console.log(`\n${pass} ok, ${fail} fehlgeschlagen, ${skip} übersprungen`);
process.exit(fail ? 1 : 0);
