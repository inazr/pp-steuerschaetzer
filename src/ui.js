// Oberfläche: Datei laden, Einstellungen, vier Reiter mit Tabellen, Charts und CSV-Export.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const YEAR = +TODAY.slice(0, 4);
const TAB_KEY = STORE_KEY + '-tab', DISC_KEY = STORE_KEY + '-disclaimer';

const ui = { data: null, settings: loadSettings(localStorage), depots: null, result: null, alloc: null, plan: null, target: '', tab: 0 };
try { ui.tab = Math.min(3, Math.max(0, +localStorage.getItem(TAB_KEY) || 0)); } catch { /* egal */ }

const S = () => ({ ...ui.settings, depots: ui.depots });
const secName = u => (ui.data.securities.find(s => s.uuid === u) || {}).name || u;
const secIsin = u => (ui.data.securities.find(s => s.uuid === u) || {}).isin || '';
const depName = u => (ui.data.portfolios.find(p => p.uuid === u) || {}).name || u;
const multiDepot = () => (ui.depots || []).length > 1;
const eurTd = (x, cls = '') => `<td class="${x < 0 ? 'neg ' : ''}${cls}">${fmtEur(x)}</td>`;
const save = () => saveSettings(localStorage, ui.settings);

// ---------- Datei laden ----------
async function loadFile(file) {
  const err = $('#load-error');
  err.hidden = true;
  try {
    const text = await readPortfolioFile(await file.arrayBuffer());
    const data = extractPortfolio(text);
    if (!data.portfolios.length) throw new Error('NO_PORTFOLIOS');
    ui.data = data;
    ui.depots = data.portfolios.map(p => p.uuid);
    ui.plan = null;
    $('#file-name').textContent = file.name;
    $('#empty').hidden = true; $('#tabs').hidden = false; $('#kpis').hidden = false;
    recompute();
    showTab(ui.tab);
  } catch (e) {
    const m = String(e && e.message || e);
    err.textContent = m === 'UNSUPPORTED_FORMAT'
      ? 'Dieses Dateiformat wird nicht unterstützt (binär oder verschlüsselt). Bitte in Portfolio Performance über „Datei → Speichern unter → XML“ unverschlüsselt speichern.'
      : m === 'NO_PORTFOLIOS' ? 'Die Datei enthält keine Depots.'
        : 'Die Datei konnte nicht gelesen werden: ' + m;
    err.hidden = false;
    $('#empty').hidden = false;
  }
}

// ---------- Berechnung ----------
function recompute() {
  ui.result = replay(ui.data, S(), TODAY);
  ui.alloc = optimizeAllowance(ui.result, ui.data, S(), YEAR);
  if (ui.plan) ui.plan = planNetSale(ui.result, ui.data, S(), YEAR, ui.planTarget);
  renderKpis();
  renderAll();
}

function marketValue() {
  return ui.result.lots.reduce((s, l) => s + l.shares * ((ui.result.latest.get(l.security) || [])[1] || 0), 0);
}

function renderKpis() {
  const r = ui.result;
  const vpPrev = r.vpRows.filter(x => x.year === YEAR - 1);
  const k = [
    ['Depotwert', fmtEur(marketValue()), (n => `${n} ${n === 1 ? 'Wertpapier' : 'Wertpapiere'}`)(new Set(r.lots.map(l => l.security)).size) + ` · ${r.lots.length} Lots`],
    [`Vorabpauschale ${YEAR - 1}`, fmtEur(vpPrev.reduce((s, x) => s + x.vp, 0)),
      `steuerpflichtig ${fmtEur(vpPrev.reduce((s, x) => s + x.taxable, 0))} · Steuer ${fmtEur(vpPrev.reduce((s, x) => s + x.tax, 0))} · ${depotScope(ui.depots, ui.data.portfolios.length)}`],
    [`Freibetrag ${YEAR} frei`, fmtEur(ui.alloc.remaining), `von ${fmtEur(ui.alloc.total)} · genutzt ${fmtEur(ui.alloc.used)} · ${depotScope(ui.depots, ui.data.portfolios.length)}`],
    ['Steuersatz', fmtPct(taxRate(ui.settings, YEAR)), ui.settings.kirchensteuer ? 'inkl. Soli und Kirchensteuer' : 'inkl. Soli'],
  ];
  $('#kpis').innerHTML = k.map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d.split(' · ').map(x => `<span class="nw">${x}</span>`).join(' · ')}</div></div>`).join('');
}

function renderAll() { renderOverview(); renderVp(); renderAllowance(); renderPlan(); renderCharts(); }

// ---------- Reiter 1: Übersicht ----------
function messages() {
  const r = ui.result, out = [];
  if (r.errors.length) out.push(`<div class="msg err"><b>Buchungen passen nicht zusammen</b> – Ergebnisse für die betroffenen Wertpapiere sind unvollständig:<ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
  const stale = ui.data.securities.filter(s => r.lots.some(l => l.security === s.uuid)).map(s => [s, r.latest.get(s.uuid)])
    .filter(([, p]) => !p || (Date.parse(TODAY) - Date.parse(p[0])) / 864e5 > 7)
    .map(([s, p]) => p ? `Letzter Kurs für ${s.name} ist vom ${fmtDate(p[0])} – bitte Kurse in Portfolio Performance aktualisieren.` : `Kein Kurs für ${s.name} – Wertpapier wird in Freibetrag und Verkaufsplanung nicht berücksichtigt.`);
  const warns = [...ui.data.warnings, ...r.warnings, ...stale];
  if (warns.length) out.push(`<div class="msg warn"><b>Hinweise</b><ul>${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  return out.join('');
}

function renderOverview() {
  const s = ui.settings, d = ui.data, r = ui.result;
  const prefill = prefillUsed(r, S(), YEAR);
  const held = sec => r.lots.filter(l => l.security === sec).reduce((a, l) => a + l.shares, 0);
  const secs = d.securities.filter(x => d.txs.some(t => t.security === x.uuid));
  const ftSelect = x => `<select data-ft="${esc(x.isin || x.uuid)}" aria-label="Fondstyp ${esc(x.name)}">${Object.entries(FUND_TYPES).map(([k, v]) => `<option value="${k}"${fundTypeOf(s, x) === k ? ' selected' : ''}>${v.label}${v.vp ? ` (TFS ${v.tfs * 100} %)` : ''}</option>`).join('')}</select>`;
  $('#p0').innerHTML = `
    ${messages()}
    <div class="grid">
      <div class="card">
        <h2>Steuerliche Einstellungen</h2>
        <div class="fields">
          <div class="f"><label for="s-veranl">Veranlagung</label><div class="in"><select id="s-veranl"><option value="single"${s.veranlagung === 'single' ? ' selected' : ''}>Einzeln</option><option value="joint"${s.veranlagung === 'joint' ? ' selected' : ''}>Zusammen (Ehe/Lebenspartnerschaft)</option></select></div></div>
          <div class="f"><label for="s-land">Bundesland (Kirchensteuer)</label><div class="in"><select id="s-land"><option value="default"${s.bundesland === 'default' ? ' selected' : ''}>Übrige Länder (9 %)</option><option value="bayern"${s.bundesland === 'bayern' ? ' selected' : ''}>Bayern (8 %)</option><option value="baden_wuerttemberg"${s.bundesland === 'baden_wuerttemberg' ? ' selected' : ''}>Baden-Württemberg (8 %)</option></select></div></div>
          <label class="chk"><input type="checkbox" id="s-kist"${s.kirchensteuer ? ' checked' : ''}> Kirchensteuerpflichtig</label>
          <div class="f"><label for="s-used">Freibetrag ${YEAR} bereits genutzt</label><div class="in"><input id="s-used" type="number" min="0" step="0.01" inputmode="decimal" placeholder="${prefill.toFixed(2)}" value="${s.genutzt ?? ''}"><span class="u">€</span></div>
            <span class="h">Leer = Vorbelegung ${fmtEur(prefill)}: steuerpflichtige Vorabpauschale ${YEAR - 1} plus Verkäufe ${YEAR} der ausgewählten Depots. Andere Banken oder Ausschüttungen selbst eintragen.</span></div>
        </div>
      </div>
      <div class="card">
        <h2>Depots</h2>
        ${d.portfolios.length > 1 ? `<div class="depots">${d.portfolios.map(p => `<label class="chk"><input type="checkbox" data-depot="${esc(p.uuid)}"${ui.depots.includes(p.uuid) ? ' checked' : ''}> ${esc(p.name)}</label>`).join('')}</div>
          <p class="note">Wähle die Depots einer Person (bei Zusammenveranlagung beider Partner): Die Auswahl bestimmt Anzeige und Freibetrag. FIFO gilt je Depot, Depotüberträge werden immer vollständig nachgebildet.</p>` : `<p>${esc(d.portfolios[0].name)}</p>`}
        <div class="facts">
          <div class="fact"><div class="l">Buchungen</div><div class="v">${d.txs.length}</div></div>
          <div class="fact"><div class="l">Ausschüttungen</div><div class="v">${d.dividends.length}</div></div>
          <div class="fact"><div class="l">Kurse</div><div class="v">${[...d.prices.values()].reduce((a, l) => a + l.length, 0).toLocaleString('de-DE')}</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Wertpapiere</h2><span class="sub">Fondstyp bestimmt Teilfreistellung und Vorabpauschale. Wird je ISIN gespeichert.</span></div>
      <div class="tablebox"><table>
        <thead><tr><th>Wertpapier</th><th>ISIN</th><th>Bestand</th><th>Kurs</th><th>Kursdatum</th><th>Wert</th><th>Fondstyp</th></tr></thead>
        <tbody>${secs.map(x => { const p = r.latest.get(x.uuid); const h = held(x.uuid); return `<tr><td class="txt">${esc(x.name)}</td><td>${esc(x.isin)}</td><td>${fmtShares(h)}</td><td>${p ? fmtEur(p[1]) : '–'}</td><td class="sub">${p ? fmtDate(p[0]) : '–'}</td><td>${p ? fmtEur(h * p[1]) : '–'}</td><td>${ftSelect(x)}</td></tr>`; }).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Unrealisierte Gewinne je Lot</h2><span class="sub">Zum letzten Kurs · steuerpflichtig nach Teilfreistellung und Anrechnung bereits versteuerter Vorabpauschalen</span></div>
      <div class="chart" id="c-lots"></div>
    </div>`;
  const lotsEl = $('#c-lots');
  lotsEl.style.height = Math.min(560, Math.max(240, r.lots.length * 30 + 70)) + 'px';
}

// ---------- Reiter 2: Vorabpauschale ----------
function renderVp() {
  const rows = [...ui.result.vpRows].sort((a, b) => b.year - a.year || secName(a.security).localeCompare(secName(b.security)) || depName(a.depot).localeCompare(depName(b.depot)));
  const years = [...new Set(rows.map(r => r.year))];
  const body = years.map(y => {
    const ys = rows.filter(r => r.year === y);
    const sum = k => ys.reduce((s, r) => s + r[k], 0);
    return ys.map(r => `<tr><td>${r.year}</td>${multiDepot() ? `<td class="txt">${esc(depName(r.depot))}</td>` : ''}<td class="txt">${esc(secName(r.security))}</td>${eurTd(r.wertAnfang)}${eurTd(r.wertEnde)}${eurTd(r.basisertrag)}${eurTd(r.ausschuettungen)}${eurTd(r.vp)}<td>${fmtPct(r.tfs)}</td>${eurTd(r.taxable)}${eurTd(r.tax)}</tr>`).join('')
      + `<tr class="sum"><td>Summe ${y}</td>${multiDepot() ? '<td></td>' : ''}<td class="txt">Basiszins ${fmtPct(ys[0].basiszins)}</td>${eurTd(sum('wertAnfang'))}${eurTd(sum('wertEnde'))}${eurTd(sum('basisertrag'))}${eurTd(sum('ausschuettungen'))}${eurTd(sum('vp'))}<td></td>${eurTd(sum('taxable'))}${eurTd(sum('tax'))}</tr>`;
  }).join('');
  const bz = Object.entries(LAW.basiszins.values).map(([y, v]) => `<tr><td>${y}</td><td>${fmtPct(v)}</td><td class="txt">${esc(LAW.basiszins.source[y])}</td></tr>`).join('');
  $('#p1').innerHTML = `
    <div class="card">
      <div class="card-h"><h2>Vorabpauschale je Jahr</h2><span class="sub">Brutto vor Teilfreistellung · fließt am ersten Werktag des Folgejahres zu</span></div>
      ${rows.length ? '<div class="chart" id="c-vp"></div>' : '<p class="note">Keine Vorabpauschale angefallen (oder keine Fonds mit Kursen zu Jahresbeginn und -ende).</p>'}
    </div>
    <div class="card">
      <div class="card-h"><h2>Berechnung nach § 18 InvStG</h2><button class="btn" id="csv-vp"${rows.length ? '' : ' disabled'}>CSV exportieren</button></div>
      <p class="note">Basisertrag = Wert 01.01. × Basiszins × 0,7, höchstens Wertsteigerung + Ausschüttungen; davon gehen die Ausschüttungen ab. Im Kaufjahr je vollem Monat vor dem Kauf ein Zwölftel weniger. Steuer vor Sparerpauschbetrag. Jahre mit negativem Basiszins (2021, 2022) ergeben keine Vorabpauschale.</p>
      <div class="tablebox"><table>
        <thead><tr><th>Jahr</th>${multiDepot() ? '<th>Depot</th>' : ''}<th>Wertpapier</th><th>Wert 01.01.</th><th>Wert 31.12.</th><th>Basisertrag</th><th>Ausschüttungen</th><th>Vorabpauschale</th><th>TFS</th><th>Steuerpflichtig</th><th>Steuer</th></tr></thead>
        <tbody>${body || `<tr><td class="txt" colspan="11">Keine Einträge</td></tr>`}</tbody>
      </table></div>
      <details><summary>Basiszins je Jahr</summary><div class="tablebox legal"><table><thead><tr><th>Jahr</th><th>Basiszins</th><th>Quelle</th></tr></thead><tbody>${bz}</tbody></table></div></details>
    </div>`;
}

// ---------- Lot-Tabellen (Freibetrag, Verkaufsplan) ----------
function lotTable(rows, cols) {
  const groups = [];
  for (const r of rows) {
    const k = r.lot.depot + '|' + r.lot.security;
    let gr = groups.find(x => x.k === k);
    if (!gr) groups.push(gr = { k, depot: r.lot.depot, security: r.lot.security, rows: [] });
    gr.rows.push(r);
  }
  const head = `<tr><th>Wertpapier / Lot</th><th>Stück</th><th>Kaufdatum</th><th>Einstand</th><th>Kurs</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>`;
  const body = groups.map(gr => {
    const title = `${esc(secName(gr.security))} <span class="sub">${esc(secIsin(gr.security))}${multiDepot() ? ' · ' + esc(depName(gr.depot)) : ''}</span>`;
    const sum = c => gr.rows.reduce((s, r) => s + c[1](r), 0);
    return `<tr class="grp"><td colspan="${5 + cols.length}">${title}</td></tr>`
      + gr.rows.map(r => `<tr><td class="sub">Lot ${fmtDate(r.lot.buyDate)}${r.exempt ? ' (Bestandsschutz)' : ''}</td><td>${fmtShares(r.shares)}</td><td>${fmtDate(r.lot.buyDate)}</td><td>${fmtEur(r.lot.cost)}</td><td>${fmtEur(r.price)}</td>${cols.map(c => eurTd(c[1](r))).join('')}</tr>`).join('')
      + (gr.rows.length > 1 ? `<tr class="sum"><td>Summe</td><td>${fmtShares(gr.rows.reduce((s, r) => s + r.shares, 0))}</td><td></td><td></td><td></td>${cols.map(c => eurTd(sum(c))).join('')}</tr>` : '');
  }).join('');
  return `<div class="tablebox"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Reiter 3: Freibetrag ----------
function renderAllowance() {
  const a = ui.alloc;
  $('#p2').innerHTML = `
    <div class="card">
      <div class="card-h"><h2>Sparerpauschbetrag ${YEAR}</h2><button class="btn" id="csv-fb"${a.rows.length ? '' : ' disabled'}>CSV exportieren</button></div>
      <div class="facts">
        <div class="fact"><div class="l">Gesamt</div><div class="v">${fmtEur(a.total)}</div></div>
        <div class="fact"><div class="l">Bereits genutzt</div><div class="v">${fmtEur(a.used)}</div></div>
        <div class="fact"><div class="l">Verbleibend</div><div class="v">${fmtEur(a.remaining)}</div></div>
        <div class="fact"><div class="l">Vorschlag nutzt</div><div class="v">${fmtEur(a.harvested)}</div></div>
      </div>
      <div class="chart sm" id="c-fb" style="height:120px"></div>
      <p class="note">Verkaufen und sofort zurückkaufen: Der steuerpflichtige Gewinn füllt den freien Betrag, der Einstandskurs steigt, spätere Gewinne fallen niedriger aus. Verkauft wird je Depot streng nach FIFO, steht ein Lot mit Verlust vorn, endet der Vorschlag für dieses Wertpapier. Ordergebühren und Kursbewegungen zwischen Verkauf und Rückkauf sind nicht berücksichtigt. Gerechnet mit dem letzten Kurs aus der Datei.</p>
    </div>
    <div class="card">
      <h2>Vorschlag</h2>
      ${a.rows.length ? lotTable(a.rows, [['Erlös', r => r.gross], ['Gewinn stpfl.', r => r.gainTaxable]]) : `<p class="note">${a.remaining < 0.01 ? 'Der Freibetrag ist bereits ausgeschöpft.' : 'Keine Lots mit steuerpflichtigem Gewinn an der FIFO-Spitze.'}</p>`}
    </div>`;
}

// ---------- Reiter 4: Verkaufsplanung ----------
function renderPlan() {
  const p = ui.plan;
  $('#p3').innerHTML = `
    <div class="card">
      <h2>Wie viel muss ich verkaufen?</h2>
      <form class="target" id="plan-form">
        <div class="f"><label for="plan-target">Ich brauche netto</label><div class="in"><input id="plan-target" type="number" min="1" step="0.01" inputmode="decimal" value="${esc(ui.target)}" required><span class="u">€</span></div></div>
        <button class="btn primary" type="submit">Berechnen</button>
        ${p ? '<button class="btn" type="button" id="csv-plan">CSV exportieren</button>' : ''}
      </form>
      <p class="note">Verkauft wird je Depot nach FIFO; zwischen Wertpapieren wählt der Plan immer den Lot mit der geringsten Steuer je Euro netto. Freibetrag (${fmtEur(ui.alloc.remaining)} frei) wird zuerst verbraucht. Verluste werden nicht verrechnet (konservativ), Ordergebühren nicht berücksichtigt.</p>
      ${p ? `<div class="facts">
        <div class="fact"><div class="l">Brutto-Erlös</div><div class="v">${fmtEur(p.gross)}</div></div>
        <div class="fact"><div class="l">Steuer</div><div class="v">${fmtEur(p.tax)}</div></div>
        <div class="fact"><div class="l">Netto</div><div class="v">${fmtEur(p.net)}</div></div>
        <div class="fact"><div class="l">Freibetrag genutzt</div><div class="v">${fmtEur(p.allowanceUsed)}</div></div>
      </div>${p.reached ? '' : `<div class="msg warn">Das Ziel ist mit dem Bestand nicht erreichbar. Gezeigt wird der Verkauf aller Lots mit Kurs.</div>`}` : ''}
    </div>
    ${p && p.rows.length ? `<div class="card"><h2>Von Brutto zu Netto</h2><div class="chart" id="c-plan"></div></div>
    <div class="card"><h2>Verkaufsplan</h2>${lotTable(p.rows, [['Erlös', r => r.gross], ['Gewinn', r => r.gain], ['Freibetrag', r => r.allowance], ['Steuer', r => r.tax], ['Netto', r => r.net]])}</div>` : ''}`;
}

// ---------- Charts ----------
const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const tokens = () => ({
  ink: cssv('--ink'), ink2: cssv('--ink-2'), ink3: cssv('--ink-3'), line: cssv('--line'), surface: cssv('--surface'),
  series: ['--s1', '--s2', '--s3', '--s4', '--s5', '--s7'].map(cssv), fontUi: cssv('--font-ui'), fontNum: cssv('--font-num'),
});
let fontsReady = null;
function chart(id, option) {
  const el = document.getElementById(id);
  if (!el || el.closest('[hidden]')) return;
  const inst = echarts.getInstanceByDom(el) || echarts.init(el, null, { renderer: 'canvas' });
  inst.setOption(option, true);
  inst.resize(); // Größe kann sich geändert haben, während der Reiter verborgen war
}
async function renderCharts() {
  if (!ui.result) return;
  // ECharts zeichnet auf Canvas: Schriften müssen vor dem ersten Zeichnen geladen sein
  fontsReady = fontsReady || Promise.all([document.fonts.load('400 12px "Public Sans"'), document.fonts.load('400 12px "JetBrains Mono"')]).catch(() => {});
  await fontsReady;
  const t = tokens();
  if (ui.tab === 0) chart('c-lots', optLotGains(ui.result, ui.data, S(), t));
  if (ui.tab === 1 && ui.result.vpRows.length) chart('c-vp', optVpByYear(ui.result.vpRows, ui.data, t));
  if (ui.tab === 2) chart('c-fb', optAllowance(ui.alloc, t));
  if (ui.tab === 3 && ui.plan && ui.plan.rows.length) chart('c-plan', optWaterfall(ui.plan, ui.data, t));
}

// ---------- Reiter ----------
function showTab(i) {
  ui.tab = i;
  try { localStorage.setItem(TAB_KEY, String(i)); } catch { /* egal */ }
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.tab === i)));
  $$('[data-panel]').forEach(p => { p.hidden = !ui.data || +p.dataset.panel !== i; });
  renderCharts();
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Ereignisse ----------
$('#file').addEventListener('change', e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; });
let dragDepth = 0;
addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); const f = e.dataTransfer.files[0]; if (f) loadFile(f); });
$('#tabs').addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) showTab(+b.dataset.tab); });

document.addEventListener('change', e => {
  const el = e.target;
  if (!ui.data) return;
  if (el.id === 's-veranl') ui.settings.veranlagung = el.value;
  else if (el.id === 's-land') ui.settings.bundesland = el.value;
  else if (el.id === 's-kist') ui.settings.kirchensteuer = el.checked;
  else if (el.id === 's-used') { const v = el.value.replace(',', '.').trim(); ui.settings.genutzt = v === '' || !isFinite(+v) ? null : Math.max(0, +v); }
  else if (el.dataset.ft) ui.settings.fundTypes = { ...ui.settings.fundTypes, [el.dataset.ft]: el.value };
  else if (el.dataset.depot) {
    ui.depots = $$('[data-depot]').filter(x => x.checked).map(x => x.dataset.depot);
    if (!ui.depots.length) { el.checked = true; ui.depots = [el.dataset.depot]; }
  } else return;
  save();
  recompute();
});
document.addEventListener('submit', e => {
  if (e.target.id !== 'plan-form') return;
  e.preventDefault();
  ui.target = $('#plan-target').value;
  ui.planTarget = Math.max(0, +String(ui.target).replace(',', '.') || 0);
  ui.plan = planNetSale(ui.result, ui.data, S(), YEAR, ui.planTarget);
  renderPlan();
  renderCharts();
});
document.addEventListener('click', e => {
  const id = e.target.id;
  if (id === 'csv-vp') download(`vorabpauschale-${TODAY}.csv`, csvVp(ui.result.vpRows, ui.data));
  else if (id === 'csv-fb') download(`freibetrag-${YEAR}.csv`, csvAllowance(ui.alloc, ui.data));
  else if (id === 'csv-plan') download(`verkaufsplan-${TODAY}.csv`, csvPlan(ui.plan, ui.data));
});

// Hinweis einmal je Sitzung
try { if (sessionStorage.getItem(DISC_KEY)) $('#disclaimer').hidden = true; } catch { /* egal */ }
$('#disclaimer-close').addEventListener('click', () => { $('#disclaimer').hidden = true; try { sessionStorage.setItem(DISC_KEY, '1'); } catch { /* egal */ } });

// Theme-Wechsel und Größe
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);
new MutationObserver(renderCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
addEventListener('resize', () => $$('.chart').forEach(el => { const c = echarts.getInstanceByDom(el); if (c && !el.closest('[hidden]')) c.resize(); }));
