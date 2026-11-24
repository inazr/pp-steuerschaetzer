import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  check('build: version stamped', html.includes(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version));
};
