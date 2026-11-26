// Oberfläche: Datei laden, Einstellungen, fünf Reiter mit Tabellen, Charts und CSV-Export.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const YEAR = +TODAY.slice(0, 4);
const TAB_KEY = STORE_KEY + '-tab', DISC_KEY = STORE_KEY + '-disclaimer';

const ui = { data: null, settings: loadSettings(localStorage), depots: null, result: null, led: null, alloc: null, altAlloc: null, plan: null, target: '', tab: 0, banksOffOpen: false };
try { ui.tab = Math.min(4, Math.max(0, +localStorage.getItem(TAB_KEY) || 0)); } catch { /* egal */ }

const S = () => ({ ...ui.settings, depots: ui.depots });
const secName = u => (ui.data.securities.find(s => s.uuid === u) || {}).name || u;
const secIsin = u => (ui.data.securities.find(s => s.uuid === u) || {}).isin || '';
const depName = u => (ui.data.portfolios.find(p => p.uuid === u) || {}).name || u;
const accName = u => ((ui.data.accounts || []).find(a => a.uuid === u) || {}).name || u;
const tradedSecs = () => ui.data.securities.filter(x => ui.data.txs.some(t => t.security === x.uuid));
const multiDepot = () => (ui.depots || []).length > 1;
const eurTd = (x, cls = '') => `<td class="${x < 0 ? 'neg ' : ''}${cls}">${fmtEur(x)}</td>`;
const fact = (l, v) => `<div class="fact"><div class="l">${l}</div><div class="v">${v}</div></div>`;
// Negative Steuer = Erstattung (Jahressaldo wie die Bank)
const taxFact = x => isRefund(x) ? fact('Erstattung', fmtEur(-x)) : fact('Steuer', fmtEur(x));
const nBanks = n => `${n} ${n === 1 ? 'Bank' : 'Banken'}`;
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
    ui.depots = selectedDepots(ui.settings, data.portfolios.map(p => p.uuid));
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
// Voll: FIFO-Neulauf (Fondstyp, Depotauswahl, Steuersatz …), dann Verrechnung
function recompute() {
  ui.result = replay(ui.data, S(), TODAY);
  recalc();
}
// Nur Verrechnung: Bank, FSA, Vortrag, Zinsen, genutzt wirken nicht auf replay (Spec: kein FIFO-Neulauf)
function recalc() {
  ui.led = ledger(ui.result, ui.data, S(), YEAR);
  ui.alloc = optimizeAllowance(ui.result, ui.data, S(), YEAR);
  ui.altAlloc = optimizeAltFreibetrag(ui.result, ui.data, S(), YEAR, ui.alloc);
  if (ui.plan) ui.plan = planNetSale(ui.result, ui.data, S(), YEAR, ui.planTarget);
  keepFocus(() => { renderKpis(); renderAll(); });
}

// ---------- Fokus über das Neuzeichnen retten ----------
// Felder werden über ihr data-*-Attribut wiedergefunden (ids der Bankfelder hängen an der Position der Bank), sonst per id.
const FOCUS_ATTRS = ['data-fsa', 'data-genutzt', 'data-vortrag-aktien', 'data-vortrag-allg', 'data-bank-of', 'data-zins', 'data-ft', 'data-depot', 'data-confirm', 'data-altfb'];
const focusKey = el => {
  if (!el || el === document.body || !el.isConnected) return null;
  const a = FOCUS_ATTRS.find(n => el.hasAttribute(n));
  return a ? { attr: a, value: el.getAttribute(a) } : el.id ? { id: el.id } : null;
};
const findFocus = k => k.id ? document.getElementById(k.id) : $$(`[${k.attr}]`).find(e => e.getAttribute(k.attr) === k.value);
// Zuletzt fokussiertes Feld (focusin). Beim Tabben feuert `change` vor dem Fokuswechsel; neu gezeichnet wird erst danach
// (s. later), dann steht hier schon das Ziel des Tabs. Fokus verlassen ohne neues Ziel (Klick daneben) löscht den Eintrag.
let lastFocus = null;
document.addEventListener('focusin', e => { lastFocus = focusKey(e.target); });
document.addEventListener('focusout', e => { if (!e.relatedTarget) lastFocus = null; });
function keepFocus(render) {
  const act = document.activeElement, k = focusKey(act) || lastFocus;
  let sel = null;
  try { if (typeof act.selectionStart === 'number') sel = [act.selectionStart, act.selectionEnd]; } catch { /* number-Felder: keine Auswahl */ }
  render();
  const el = k && findFocus(k);
  if (!el || el === document.activeElement) return;
  el.focus({ preventScroll: true });
  try { if (sel) el.setSelectionRange(sel[0], sel[1]); } catch { /* number-Felder */ }
}
// Neuzeichnen nach `change` erst im nächsten Task: der Browser schließt den Fokuswechsel (Tab) vorher ab
const later = fn => setTimeout(fn, 0);

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
    (fc => [`Vorabpauschale ${YEAR} (Prognose)`, fc.length ? fmtEur(fc.reduce((s, x) => s + x.vp, 0)) : '–',
      fc.length ? `steuerpflichtig ${fmtEur(fc.reduce((s, x) => s + x.taxable, 0))} · Steuer ${fmtEur(fc.reduce((s, x) => s + x.tax, 0))} · fällig Januar ${YEAR + 1}` : 'keine Prognose möglich'])(r.vpForecast),
    [`Freibetrag ${YEAR} frei`, fmtEur(ui.alloc.remaining), `von ${fmtEur(ui.alloc.total)} · genutzt ${fmtEur(ui.alloc.used)} · ${nBanks(ui.led.banks.filter(b => b.active).length)}${ui.led.pooled ? ' gemeinsam' : ''}`],
    ['Steuersatz', fmtPct(taxRate(ui.settings, YEAR)), ui.settings.kirchensteuer ? 'inkl. Soli und Kirchensteuer' : 'inkl. Soli'],
  ];
  $('#kpis').innerHTML = k.map(([l, v, d]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="d">${d.split(' · ').map(x => `<span class="nw">${x}</span>`).join(' · ')}</div></div>`).join('');
}

function renderAll() { renderOverview(); renderVp(); renderAllowance(); renderPlan(); renderLaw(); renderCharts(); }

// ---------- Reiter 1: Übersicht ----------
function messages() {
  const r = ui.result, out = [];
  if (r.errors.length) out.push(`<div class="msg err"><b>Buchungen passen nicht zusammen</b> – Ergebnisse für die betroffenen Wertpapiere sind unvollständig:<ul>${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`);
  const stale = ui.data.securities.filter(s => r.lots.some(l => l.security === s.uuid)).map(s => [s, r.latest.get(s.uuid)])
    .filter(([, p]) => !p || (Date.parse(TODAY) - Date.parse(p[0])) / 864e5 > 7)
    .map(([s, p]) => p ? `Letzter Kurs für ${s.name} ist vom ${fmtDate(p[0])} – bitte Kurse in Portfolio Performance aktualisieren.` : `Kein Kurs für ${s.name} – Wertpapier wird in Freibetrag und Verkaufsplanung nicht berücksichtigt.`);
  const guessed = tradedSecs().filter(x => fundTypeGuessed(ui.settings, x)).length;
  if (guessed) out.push(`<div class="msg warn guess-msg"><span><b>${guessed} ${guessed === 1 ? 'Fondstyp ist' : 'Fondstypen sind'} geraten</b> – bitte in der Wertpapier-Tabelle prüfen. Der Typ bestimmt Vorabpauschale und Teilfreistellung.</span><button class="btn" type="button" id="confirm-all">Alle bestätigen</button></div>`);
  const warns = [...ui.data.warnings, ...r.warnings, ...stale];
  if (warns.length) out.push(`<div class="msg warn"><b>Hinweise</b><ul>${warns.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
  return out.join('');
}

function renderOverview() {
  const s = ui.settings, d = ui.data, r = ui.result;
  const held = sec => r.lots.filter(l => l.security === sec).reduce((a, l) => a + l.shares, 0);
  const secs = tradedSecs();
  const ftSelect = x => `<select data-ft="${esc(x.isin || x.uuid)}" aria-label="Fondstyp ${esc(x.name)}">${Object.entries(FUND_TYPES).map(([k, v]) => `<option value="${k}"${fundTypeOf(s, x) === k ? ' selected' : ''}>${v.label}${v.vp ? ` (TFS ${v.tfs * 100} %)` : ''}</option>`).join('')}</select>`;
  // Altbestand je Wertpapier: Markierung mit Ø-Einstand ursprünglich und ab 2018 als Tooltip
  const altPills = x => altGroups(r.lots.filter(l => l.security === x.uuid)).map(a => ` <span class="pill ${a.pre2009 ? 'good' : 'muted'}" title="${esc(altText(a) + ` (${fmtShares(a.shares)} Stück)`)}">${esc(a.mark)}</span>`).join('');
  // Geratener Typ: markiert, mit ✓ als explizite Wahl übernehmen
  const ftCell = x => fundTypeGuessed(s, x)
    ? `<div class="ft guess">${ftSelect(x)}<span class="pill warn">geraten</span><button class="btn ok" type="button" data-confirm="${esc(x.uuid)}" aria-label="Fondstyp ${esc(x.name)} bestätigen" title="Bestätigen">✓</button></div>`
    : ftSelect(x);
  $('#p0').innerHTML = `
    ${messages()}
    <div class="grid">
      <div class="card">
        <h2>Steuerliche Einstellungen</h2>
        <div class="fields">
          <div class="f"><label for="s-veranl">Veranlagung</label><div class="in"><select id="s-veranl"><option value="single"${s.veranlagung === 'single' ? ' selected' : ''}>Einzeln</option><option value="joint"${s.veranlagung === 'joint' ? ' selected' : ''}>Zusammen (Ehe/Lebenspartnerschaft)</option></select></div></div>
          <div class="f"><label for="s-land">Bundesland (Kirchensteuer)</label><div class="in"><select id="s-land"><option value="default"${s.bundesland === 'default' ? ' selected' : ''}>Übrige Länder (9 %)</option><option value="bayern"${s.bundesland === 'bayern' ? ' selected' : ''}>Bayern (8 %)</option><option value="baden_wuerttemberg"${s.bundesland === 'baden_wuerttemberg' ? ' selected' : ''}>Baden-Württemberg (8 %)</option></select></div></div>
          <label class="chk"><input type="checkbox" id="s-kist"${s.kirchensteuer ? ' checked' : ''}> Kirchensteuerpflichtig</label>
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
    ${renderBanks()}
    ${renderAltFb()}
    <div class="card">
      <div class="card-h"><h2>Wertpapiere</h2><span class="sub">Fondstyp bestimmt Teilfreistellung und Vorabpauschale. Wird je ISIN gespeichert.</span></div>
      <div class="tablebox"><table>
        <thead><tr><th>Wertpapier</th><th>ISIN</th><th>Bestand</th><th>Kurs</th><th>Kursdatum</th><th>Wert</th><th>Fondstyp</th></tr></thead>
        <tbody>${secs.map(x => { const p = r.latest.get(x.uuid); const h = held(x.uuid); return `<tr><td class="txt">${esc(x.name)}${altPills(x)}</td><td>${esc(x.isin)}</td><td>${fmtShares(h)}</td><td>${p ? fmtEur(p[1]) : '–'}</td><td class="sub">${p ? fmtDate(p[0]) : '–'}</td><td>${p ? fmtEur(h * p[1]) : '–'}</td><td>${ftCell(x)}</td></tr>`; }).join('')}</tbody>
      </table></div>
    </div>
    <div class="card">
      <div class="card-h"><h2>Unrealisierte Gewinne je Kauf</h2><span class="sub">Zum letzten Kurs · steuerpflichtig nach Teilfreistellung und Anrechnung bereits versteuerter Vorabpauschalen${r.lots.some(l => l.alt) ? ' · Altbestand: Gewinn ab ursprünglichem Einstand, Altgewinn vor 2009 steuerfrei' : ''}</span></div>
      <div class="chart" id="c-lots"></div>
    </div>`;
}

// ---------- Banken & Freistellungsaufträge ----------
const fmtNum = x => (round2(x) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Eingabefeld: eingetragener Wert oder leer (= berechnet, als Placeholder)
const amountField = (id, label, attr, key, value, computed, hint = '') => `<div class="f"><label for="${id}">${label}</label>
  <div class="in"><input id="${id}" type="number" min="0" step="0.01" inputmode="decimal" ${attr}="${esc(key)}" value="${typeof value === 'number' ? value : ''}" placeholder="${fmtNum(computed)}"><span class="u">€</span></div>${hint ? `<span class="h">${hint}</span>` : ''}</div>`;
// Eingabe lesen: leer = null (berechneter Wert gilt), sonst ≥ 0
const amountOf = el => el.value.trim() === '' ? null : Math.max(0, round2(+el.value.replace(',', '.') || 0));

// Bankname als Überschrift, „Bank“ nur als kleine Beschriftung (Depotnamen tragen oft schon „Depot …“)
const bankCap = '<span class="sub cap">Bank</span>';

// Bank-Auswahl je Mitglied: „eigene Bank“ (Depots, Konten ohne Depot) bzw. „wie Depot“ (Verrechnungskonten) plus alle anderen Banken
function memberSelect(u, name, isAcc, bank) {
  const refd = isAcc && ui.data.portfolios.some(p => p.accountUuid === u);
  const cur = u !== bank.key && (ui.settings.bankOf || {})[u] === bank.key ? bank.key : '';
  const opts = [['', refd ? 'wie Depot' : 'eigene Bank'], ...ui.led.banks.filter(b => b.key !== u).map(b => [b.key, b.label])];
  return `<select data-bank-of="${esc(u)}" aria-label="Bank für ${esc(name)}">${opts.map(([k, l]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function bankBox(b, i) {
  const s = ui.settings, inc = b.income, id = `bk${i}`, pooled = ui.led.pooled;
  const vt = (s.vortrag || {})[`${YEAR}|${b.key}`] || {};
  const members = [...b.depots.map(u => [u, depName(u), false]), ...b.accounts.map(u => [u, accName(u), true])].map(([u, name, isAcc]) =>
    `<div class="member"><span class="mname">${esc(name)}</span>${memberSelect(u, name, isAcc, b)}${isAcc ? `<label class="chk"><input type="checkbox" data-zins="${esc(u)}"${zinsOn(ui.data, S(), u) ? ' checked' : ''}> Zinsen</label>` : ''}</div>`).join('');
  const src = { eingetragen: 'eingetragen', gemeinsam: `gemeinsam: ${fmtEur(ui.led.spb)} für alle Banken`,
    automatisch: b.fsa > 0 ? 'automatisch: Sparerpauschbetrag' : 'automatisch: 0 (Aufträge bei anderen Banken)' }[b.fsaSource];
  const sales = inc.aktie + inc.sonstGewinn - inc.sonstVerlust;
  const calc = `berechnet: VP ${YEAR - 1} ${fmtEur(inc.vp)} · Ausschüttungen ${fmtEur(inc.div)} · Verkäufe ${fmtEur(sales)} · Zinsen ${fmtEur(inc.zins)}, nach Verlusttöpfen`;
  return `<div class="bank">
    <div class="bank-h">${bankCap}<span>${esc(b.label)}</span>${b.vortragOverridden ? '<span class="pill info">Vortrag eingetragen</span>' : ''}${b.usedOverridden ? '<span class="pill info">genutzt eingetragen</span>' : ''}</div>
    <div class="members">${members}</div>
    <div class="fields four">
      ${amountField(`${id}-fsa`, 'Freistellungsauftrag', 'data-fsa', b.key, (s.fsa || {})[b.key], b.fsa, src)}
      ${amountField(`${id}-used`, `genutzt ${YEAR}`, 'data-genutzt', b.key, (s.genutzt || {})[`${YEAR}|${b.key}`], b.usedComputed, calc)}
      ${amountField(`${id}-va`, `Vortrag 1.1. Aktien`, 'data-vortrag-aktien', b.key, vt.aktien, b.vortragComputed.aktien, typeof vt.aktien === 'number' ? `berechnet: ${fmtEur(b.vortragComputed.aktien)}` : 'berechnet aus der Datei')}
      ${amountField(`${id}-vg`, `Vortrag 1.1. allgemein`, 'data-vortrag-allg', b.key, vt.allg, b.vortragComputed.allg, typeof vt.allg === 'number' ? `berechnet: ${fmtEur(b.vortragComputed.allg)}` : 'berechnet aus der Datei')}
    </div>
    <div class="facts">
      ${fact('Aktientopf jetzt', fmtEur(b.pots.aktien))}${fact('allg. Topf jetzt', fmtEur(b.pots.allg))}
      ${fact(pooled ? 'Frei (gemeinsam)' : 'Frei', fmtEur(b.fsaLeft))}
    </div>
    ${b.closedWithPot ? '<p class="note">Kein Bestand mehr: Der Verlusttopf ist nur per Verlustbescheinigung oder bei vollständigem Depotübertrag nutzbar (§ 43a Abs. 3 EStG).</p>' : ''}
  </div>`;
}

function renderBanks() {
  const led = ui.led, on = led.banks.filter(b => b.active), off = led.banks.filter(b => !b.active);
  return `<div class="card" id="banks">
    <div class="card-h"><h2>Banken & Freistellungsaufträge ${YEAR}</h2>${led.pooled ? '<span class="pill warn">⚠ FSA je Bank eintragen</span>' : ''}</div>
    ${led.warnings.length ? `<div class="msg warn"><ul>${led.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
    ${on.map((b, i) => bankBox(b, i)).join('') || '<p class="note">Keine Bank mit Erträgen, Bestand oder Verlusttopf.</p>'}
    ${off.length ? `<details id="banks-off"${ui.banksOffOpen ? ' open' : ''}><summary>Inaktive Banken (${off.length}) – ohne Erträge ${YEAR}, Bestand und Verlusttopf</summary><div class="banks-off">${off.map((b, i) => bankBox(b, on.length + i)).join('')}</div></details>` : ''}
    <p class="note">Leere Felder = berechneter Wert (grau). Verlusttöpfe werden ab 2018 aus der Datei fortgeschrieben; ein eingetragener Vortrag zum 1.1. ersetzt den berechneten Stand. Der Freistellungsauftrag wirkt erst auf das, was nach der Verlustverrechnung positiv bleibt. Zinsen zählen brutto; Soll- und Negativzinsen sind nicht abziehbar.</p>
  </div>`;
}

// ---------- Altbestand-Freibetrag (vor 2009), § 56 Abs. 6 InvStG ----------
// Sichtbar, solange Fondsanteile von vor 2009 im Bestand sind oder ab 2018 schon Gewinne daraus angefallen sind
const hasPre2009 = () => ui.result.lots.some(l => l.alt && l.alt.pre2009)
  || (ui.result.veranlagung || []).some(v => v.kind === 'alt100k' && ui.depots.includes(v.depot));
function renderAltFb() {
  if (!hasPre2009()) return '';
  const a = altFreibetrag(ui.result, ui.data, S(), YEAR, ui.led), key = altFbSel(ui.depots);
  // Eingabe = Rest zum 31.12. Vorjahr (Schlüssel `YEAR|Depots`); ein älterer Eintrag wird mit den Verkäufen seither fortgeschrieben
  const ovHint = !a.leftStartOverridden ? 'berechnet aus den Verkäufen ab 2018 in der Datei'
    : a.leftStartFrom < YEAR ? `fortgeschrieben aus dem Eintrag zum 31.12.${a.leftStartFrom - 1} · berechnet: ${fmtEur(a.leftStartComputed)}`
    : `berechnet: ${fmtEur(a.leftStartComputed)}`;
  const refund = round2(a.refund100k + a.refundBfh);
  return `<div class="card" id="altfb">
    <div class="card-h"><h2>Altbestand-Freibetrag (vor 2009)</h2>${a.leftStartOverridden ? '<span class="pill info">laut Steuerbescheid eingetragen</span>' : ''}</div>
    <div class="facts">
      ${fact(a.joint ? 'Freibetrag (gemeinsam)' : 'Freibetrag', fmtEur(a.total))}${fact(`verbraucht bis ${YEAR - 1}`, fmtEur(a.total - a.leftStart))}
      ${fact(`verbraucht ${YEAR}`, fmtEur(a.usedThisYear))}${fact('frei', fmtEur(a.left))}
      ${refund > 0.005 ? fact(`Erwartete Erstattung ${YEAR} (Steuererklärung)`, fmtEur(refund)) : ''}
    </div>
    <div class="fields">
      ${amountField('altfb-left', `verbleibend laut letztem Steuerbescheid (Stand 31.12.${YEAR - 1})`, 'data-altfb', key, (ui.settings.altFb || {})[`${YEAR}|${key}`],
        a.leftStartOverridden && a.leftStartFrom < YEAR ? a.leftStart : a.leftStartComputed, ovHint)}
    </div>
    ${a.joint ? '<p class="note">Der Freibetrag gilt je Person für die eigenen Anteile; hier vereinfacht als gemeinsamer Betrag für die ausgewählten Depots.</p>' : ''}
    <p class="note">Gewinne ab 2018 aus Fondsanteilen, die vor 2009 gekauft wurden, sind bis 100.000 € je Person steuerfrei (angerechnet wird hier der Gewinn vor Teilfreistellung); der Altgewinn bis 31.12.2017 bleibt ohnehin steuerfrei. Die Bank zieht trotzdem Steuer ab, zurück kommt sie über die Steuererklärung (Anlage KAP-INV). Der Rest wird jährlich festgestellt: Trage ihn aus dem letzten Bescheid ein, wenn Verkäufe fehlen (andere Banken, vor der Datei). ${a.refundBfh > 0.005 ? `Die erwartete Erstattung enthält ${fmtEur(a.refundBfh)} aus Verlusten mit Altanteilen 2009–2017 (BFH). ` : ''}Freibetrag nutzen: Reiter 3.</p>
  </div>`;
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
  const fc = ui.result.vpForecast, fsum = k => fc.reduce((s, r) => s + r[k], 0);
  const nx = ledgerNextYear(ui.result, ui.data, S(), YEAR);
  const forecast = fc.length ? `
    <div class="card">
      <div class="card-h"><h2>Prognose ${YEAR}, fällig Januar ${YEAR + 1}</h2><span class="sub">Letzter Kurs statt Kurs zum 31.12. · ändert sich bis Jahresende mit dem Kurs</span></div>
      <div class="tablebox"><table>
        <thead><tr>${multiDepot() ? '<th>Depot</th>' : ''}<th>Wertpapier</th><th>Wert 01.01.</th><th>Wert aktuell</th><th>Kurs vom</th><th>Basisertrag</th><th>Ausschüttungen bisher</th><th>Vorabpauschale</th><th>Steuerpflichtig</th><th>Steuer</th></tr></thead>
        <tbody>${fc.map(r => `<tr>${multiDepot() ? `<td class="txt">${esc(depName(r.depot))}</td>` : ''}<td class="txt">${esc(secName(r.security))}</td>${eurTd(r.wertAnfang)}${eurTd(r.wertEnde)}<td class="sub">${esc(fmtDate(r.priceDate))}</td>${eurTd(r.basisertrag)}${eurTd(r.ausschuettungen)}${eurTd(r.vp)}${eurTd(r.taxable)}${eurTd(r.tax)}</tr>`).join('')}
        <tr class="sum"><td class="txt">Summe · Basiszins ${fmtPct(fc[0].basiszins)}</td>${multiDepot() ? '<td></td>' : ''}${eurTd(fsum('wertAnfang'))}${eurTd(fsum('wertEnde'))}<td></td>${eurTd(fsum('basisertrag'))}${eurTd(fsum('ausschuettungen'))}${eurTd(fsum('vp'))}${eurTd(fsum('taxable'))}${eurTd(fsum('tax'))}</tr></tbody>
      </table></div>
      <div class="facts">
        ${fact(`Freibetrag ${nx.year}${nx.pooled ? ' (gemeinsam)' : ''}`, fmtEur(nx.total))}${fact('davon durch Vorabpauschale', fmtEur(nx.used))}
        ${fact(`Restfreibetrag ${nx.year}`, fmtEur(nx.remaining))}${fact('Steuer nach Freibetrag', fmtEur(nx.taxAfter))}
      </div>
      ${nx.banks.length > 1 ? `<div class="tablebox"><table>
        <thead><tr><th>Bank</th>${nx.pooled ? '' : '<th>Freistellungsauftrag</th>'}<th>durch Vorabpauschale</th>${nx.pooled ? '' : `<th>Restfreibetrag ${nx.year}</th>`}</tr></thead>
        <tbody>${nx.banks.map(b => `<tr><td class="txt">${esc(b.label)}</td>${nx.pooled ? '' : eurTd(b.fsa)}${eurTd(b.used)}${nx.pooled ? '' : eurTd(b.fsaLeft)}</tr>`).join('')}</tbody>
      </table></div>` : ''}
      <p class="note">Die Vorabpauschale fließt im Januar ${nx.year} zu und verbraucht den Freibetrag ${nx.year}, nicht den von ${YEAR}. Je Bank wird sie zuerst mit dem allgemeinen Verlusttopf zum Jahresende ${YEAR} verrechnet, dann mit dem Freistellungsauftrag dieser Bank; abgebucht wird nur die Steuer danach. ${nx.pooled ? 'Ohne eingetragene Freistellungsaufträge ist der Freibetrag gemeinsam gerechnet. ' : ''}Fällt der Kurs bis 31.12., sinkt die Vorabpauschale. Ausschüttungen, Verkäufe und Zinsen ${nx.year} sind nicht eingerechnet.</p>
    </div>` : '';
  $('#p1').innerHTML = forecast + `
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
      <p class="note">Basiszins je Jahr mit Fundstellen: Reiter „Gesetze &amp; Annahmen“.</p>
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
      + gr.rows.map(r => `<tr><td class="sub">Lot ${fmtDate(r.lot.buyDate)}${r.exempt ? ' (Bestandsschutz)' : ''}${r.lot.alt ? ' · ' + esc(altMark(r.lot)) : ''}</td><td>${fmtShares(r.shares)}</td><td>${fmtDate(r.lot.buyDate)}</td><td${r.lot.alt ? ` title="${esc(altText(altGroups([r.lot])[0]))}"` : ''}>${fmtEur(r.lot.cost)}</td><td>${fmtEur(r.price)}</td>${cols.map(c => eurTd(c[1](r))).join('')}</tr>`).join('')
      + (gr.rows.length > 1 ? `<tr class="sum"><td>Summe</td><td>${fmtShares(gr.rows.reduce((s, r) => s + r.shares, 0))}</td><td></td><td></td><td></td>${cols.map(c => eurTd(sum(c))).join('')}</tr>` : '');
  }).join('');
  return `<div class="tablebox"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Reiter 3: Freibetrag ----------
const potsSum = p => round2(p.aktien + p.allg);
function allowanceBank(b, pooled) {
  // fsaLeft ist der Stand vor dem Vorschlag; „nach Vorschlag“ = fsaLeft − fsaUsed
  const facts = pooled
    ? [fact('Bereits genutzt', fmtEur(b.used)), fact('Vorschlag: Gewinn', fmtEur(b.harvested)), fact('davon gegen Verlusttöpfe', fmtEur(potsSum(b.potsUsed))), fact('davon gemeinsamer Freibetrag', fmtEur(b.fsaUsed))]
    : [fact('Freistellungsauftrag', fmtEur(b.fsa)), fact('Bereits genutzt', fmtEur(b.used)), fact('Frei', fmtEur(b.fsaLeft)), fact('Vorschlag: Gewinn', fmtEur(b.harvested)),
      fact('davon gegen Verlusttöpfe', fmtEur(potsSum(b.potsUsed))), fact('Frei nach Vorschlag', fmtEur(Math.max(0, b.fsaLeft - b.fsaUsed)))];
  return `<div class="card">
    <h2>${bankCap} ${esc(b.label)}</h2>
    <div class="facts">${facts.join('')}</div>
    ${b.hint ? `<p class="note">${esc(b.hint)}</p>` : ''}
    ${b.rows.length ? lotTable(b.rows, [['Erlös', r => r.gross], ['Gewinn stpfl.', r => r.gainTaxable]]) : `<p class="note">${b.leftStart < 0.01 ? 'Der Freibetrag ist bereits ausgeschöpft.' : 'Keine Lots mit steuerpflichtigem Gewinn an der FIFO-Spitze.'}</p>`}
  </div>`;
}
function renderAllowance() {
  const a = ui.alloc, fsaHarvest = round2(a.banks.reduce((s, b) => s + b.fsaUsed, 0));
  $('#p2').innerHTML = `
    <div class="card">
      <div class="card-h"><h2>Sparerpauschbetrag ${YEAR}</h2><button class="btn" id="csv-fb"${a.rows.length ? '' : ' disabled'}>CSV exportieren</button></div>
      <div class="facts">
        ${fact(a.pooled ? 'Gesamt (gemeinsam)' : 'Freistellungsaufträge', fmtEur(a.total))}${fact('Bereits genutzt', fmtEur(a.used))}${fact('Verbleibend', fmtEur(a.remaining))}
        ${fact('Vorschlag nutzt Freibetrag', fmtEur(fsaHarvest))}${a.harvested - fsaHarvest > 0.005 ? fact('plus gegen Verlusttöpfe', fmtEur(a.harvested - fsaHarvest)) : ''}
      </div>
      <div class="chart sm" id="c-fb" style="height:120px"></div>
      <p class="note">Verkaufen und sofort zurückkaufen: Der steuerpflichtige Gewinn füllt den freien Betrag, der Einstandskurs steigt, spätere Gewinne fallen niedriger aus. Gerechnet wird je Bank wie die Bank: ein Gewinn wird erst mit ihren Verlusttöpfen verrechnet (Aktiengewinne zuerst mit dem Aktientopf), erst dann greift ihr Freistellungsauftrag. ${a.pooled ? 'Ohne eingetragene Freistellungsaufträge teilen sich die Banken einen gemeinsamen Freibetrag. ' : ''}Verkauft wird je Depot streng nach FIFO, steht ein Lot mit Verlust vorn, endet der Vorschlag für dieses Wertpapier. Ordergebühren und Kursbewegungen zwischen Verkauf und Rückkauf sind nicht berücksichtigt. Gerechnet mit dem letzten Kurs aus der Datei.</p>
    </div>
    ${a.banks.map(b => allowanceBank(b, a.pooled)).join('') || '<div class="card"><p class="note">Keine Bank mit Bestand.</p></div>'}
    ${altAllowance(ui.altAlloc)}`;
}
// Abschnitt „Altbestand-Freibetrag nutzen“ (Spec §4): unter dem FSA-Vorschlag, Lots je Bank
function altAllowance(x) {
  const cols = [['Erlös', r => r.gross], ['Gewinn (vor TFS)', r => r.raw], ['Bankabzug', r => r.bankTax], ['Erstattung erwartet', r => r.refund]];
  const banks = ui.led.banks.filter(b => x.rows.some(r => r.bank === b.key));
  return `<div class="card">
    <div class="card-h"><h2>Altbestand-Freibetrag nutzen</h2><button class="btn" id="csv-alt"${x.rows.length ? '' : ' disabled'}>CSV exportieren</button></div>
    <div class="facts">${fact('Frei', fmtEur(x.left))}${fact('Geerntet (vor TFS)', fmtEur(x.harvested))}${fact('Bankabzug', fmtEur(x.bankTax))}${fact('Erstattung erwartet', fmtEur(x.refund))}</div>
    <p class="note">${esc(x.hint)}</p>
    ${banks.map(b => `<h3>${bankCap} ${esc(b.label)}</h3>${lotTable(x.rows.filter(r => r.bank === b.key), cols)}`).join('')}
  </div>`;
}

// ---------- Reiter 4: Verkaufsplanung ----------
// Topf-Wirkung des Plans: positiv = verrechnet, negativ = Verlust kommt in den Topf
const potTd = x => `<td>${x < -0.005 ? '+' + fmtEur(-x) + ' hinein' : fmtEur(x)}</td>`;
function planBanks(p) {
  const pooled = ui.led.pooled;
  return `<div class="tablebox"><table>
    <thead><tr><th>Bank</th><th>Gebühren</th><th>Steuer (− = Erstattung)</th>${pooled ? '' : '<th>Freibetrag genutzt</th>'}<th>Aktientopf</th><th>allg. Topf</th></tr></thead>
    <tbody>${p.banks.map(b => `<tr><td class="txt">${esc(b.label)}</td>${eurTd(b.fees)}${eurTd(b.tax)}${pooled ? '' : eurTd(b.fsaUsed)}${potTd(b.potsUsed.aktien)}${potTd(b.potsUsed.allg)}</tr>`).join('')}</tbody>
  </table></div>${pooled ? `<p class="note">Gemeinsamer Freibetrag (keine Freistellungsaufträge eingetragen): insgesamt ${p.allowanceUsed < 0 ? 'frei geworden ' + fmtEur(-p.allowanceUsed) : 'genutzt ' + fmtEur(p.allowanceUsed)}.</p>` : ''}`;
}
function renderPlan() {
  const p = ui.plan;
  // Erwartete Erstattung über die Steuererklärung (Altbestand): Kennzahl aus den Summen, Spalte je Zeile nur als Richtwert; nie im Netto
  const refund = p ? round2(p.refund100k + p.refundBfh) : 0, refundRows = !!p && p.rows.some(r => r.refund > 0.005);
  const cols = [['Erlös', r => r.gross], ['Gebühr', r => r.fee], ['Gewinn', r => r.gain], ['Steuerbasis Δ', r => r.taxable], ['Freibetrag Δ', r => r.allowance], ['Steuer (− = Erstattung)', r => r.tax], ['Netto', r => r.net],
    ...(refundRows ? [['Erstattung später', r => r.refund]] : [])];
  const groups = p ? p.banks.filter(b => p.rows.some(r => r.bank === b.key)) : [];
  $('#p3').innerHTML = `
    <div class="card">
      <h2>Wie viel muss ich verkaufen?</h2>
      <form class="target" id="plan-form">
        <div class="f"><label for="plan-target">Ich brauche netto</label><div class="in"><input id="plan-target" type="number" min="1" step="0.01" inputmode="decimal" value="${esc(ui.target)}" required><span class="u">€</span></div></div>
        <div class="f sm"><label for="p-fix">Gebühr je Order</label><div class="in"><input id="p-fix" type="number" min="0" step="0.01" inputmode="decimal" value="${+ui.settings.gebuehrFix || 0}"><span class="u">€</span></div></div>
        <div class="f sm"><label for="p-pct">plus vom Erlös</label><div class="in"><input id="p-pct" type="number" min="0" step="0.01" inputmode="decimal" value="${+ui.settings.gebuehrProz || 0}"><span class="u">%</span></div></div>
        <button class="btn primary" type="submit">Berechnen</button>
        ${p ? '<button class="btn" type="button" id="csv-plan">CSV exportieren</button>' : ''}
      </form>
      <p class="note">Verkauft wird je Depot nach FIFO; zwischen Wertpapieren wählt der Plan immer den Lot mit der geringsten Steuer je Euro netto. Gerechnet wird wie die Bank im Jahressaldo: Die Verkäufe kommen zu den Erträgen ${YEAR} ihrer Bank hinzu, Gewinne werden mit den Verlusttöpfen verrechnet und dann mit dem Freistellungsauftrag (${fmtEur(ui.alloc.remaining)} frei). Verluste geben bereits genutzten Freibetrag wieder frei oder führen zur <b>Erstattung</b> schon gezahlter Steuer (negative Steuer); Aktienverluste nur mit Aktiengewinnen, sonst wachsen sie den Aktientopf. Die feste Gebühr fällt einmal je Depot und Wertpapier an; Gebühren mindern den steuerpflichtigen Gewinn. Steuerbasis Δ und Freibetrag Δ zeigen, wie sich die Zeile auf das Jahr ihrer Bank auswirkt.</p>
      ${p ? `<div class="facts">
        ${fact('Brutto-Erlös', fmtEur(p.gross))}${fact('Gebühren', fmtEur(p.fees))}${taxFact(p.tax)}${fact('Netto', fmtEur(p.net))}
        ${p.allowanceUsed < -0.005 ? fact('Freibetrag frei geworden', fmtEur(-p.allowanceUsed)) : fact('Freibetrag genutzt', fmtEur(p.allowanceUsed))}
        ${refund > 0.005 ? fact('Erwartete Erstattung (Steuererklärung)', fmtEur(refund)) : ''}
      </div>${refund > 0.005 || refundRows ? `<p class="note">Netto ist die Auszahlung der Bank. Gewinne aus Fondsanteilen von vor 2009 (Altbestand-Freibetrag)${p.refundBfh > 0.005 ? ' und Verluste aus Altanteilen 2009–2017 (BFH)' : ''} rechnet die Bank voll ab; die erwartete Erstattung kommt erst mit dem Steuerbescheid und ist im Netto nicht enthalten. Die Spalte „Erstattung später“ ist ein Richtwert je Zeile, maßgeblich ist die Kennzahl.</p>` : ''}${p.reached ? '' : `<div class="msg warn">Das Ziel ist mit dem Bestand nicht erreichbar. Gezeigt wird der Verkauf aller Lots mit Kurs.</div>`}` : ''}
    </div>
    ${p && p.rows.length ? `<div class="card"><h2>Von Brutto zu Netto</h2><div class="chart" id="c-plan"></div></div>
    <div class="card"><h2>Je Bank</h2>${planBanks(p)}</div>
    <div class="card"><h2>Verkaufsplan</h2>${groups.length > 1
      ? groups.map(b => `<h3>${bankCap} ${esc(b.label)}</h3>${lotTable(p.rows.filter(r => r.bank === b.key), cols)}`).join('')
      : lotTable(p.rows, cols)}</div>` : ''}`;
}

// ---------- Reiter 5: Gesetze & Annahmen ----------
const STATUS_PILL = { G: 'good', B: 'info', E: 'warn', A: 'muted' };
function renderLaw() {
  const rows = lawRows(ui.settings, YEAR);
  const pill = st => `<span class="pill ${STATUS_PILL[st]}" title="${esc(LAW_STATUS[st])}">${st}</span>`;
  const norm = r => r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.norm)}</a>` : esc(r.norm);
  $('#p4').innerHTML = `
    <div class="card">
      <div class="card-h"><h2>Gesetze &amp; Annahmen</h2><span class="sub">Stand ${esc(fmtDate(LAW_STAND))} · Werte für ${YEAR} mit deinen Steuer-Einstellungen</span></div>
      <p class="note">Status: ${Object.keys(LAW_STATUS).map(k => `${pill(k)} ${esc(LAW_STATUS[k])}`).join(' · ')}. Die Zahlen in dieser Tabelle sind dieselben, mit denen das Tool rechnet.</p>
      <div class="tablebox legal"><table>
        <thead><tr><th>Bereich</th><th>Wert</th><th>Status</th><th>Norm</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${esc(r.bereich)}</td><td${r.wert.length <= 32 ? ' class="v"' : ''}>${esc(r.wert)}</td><td>${pill(r.status)}</td><td>${norm(r)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="note">Links öffnen Gesetze im Internet, BMF, BFH bzw. eine Wiedergabe des BMF-Schreibens (ältere Basiszins-Schreiben stehen nicht mehr beim BMF). Offline öffnen sie nichts.</p>
    </div>`;
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
  if (ui.tab === 0) {
    const o = optLotGains(ui.result, ui.data, S(), t), el = $('#c-lots');
    if (el) el.style.height = lotChartHeight(o) + 'px'; // ein Diagramm je Wertpapier untereinander
    chart('c-lots', o);
  }
  if (ui.tab === 1 && ui.result.vpRows.length) chart('c-vp', optVpByYear(ui.result.vpRows, ui.data, t));
  if (ui.tab === 2) chart('c-fb', optAllowance({ ...ui.alloc, harvested: round2(ui.alloc.banks.reduce((s, b) => s + b.fsaUsed, 0)) }, t));
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

// Bank-Einstellungen (Zuordnung, Zinsen, FSA, genutzt, Vortrag) und Altbestand-Freibetrag übernehmen; false = kein solches Feld
function bankSetting(el) {
  if (el.dataset.bankOf) ui.settings.bankOf = assignBank(ui.settings.bankOf, el.dataset.bankOf, el.value || null);
  else if (el.dataset.zins) ui.settings.zinsen = setKey(ui.settings.zinsen, el.dataset.zins, el.checked);
  else if (el.dataset.fsa) ui.settings.fsa = setKey(ui.settings.fsa, el.dataset.fsa, amountOf(el));
  else if (el.hasAttribute('data-altfb')) ui.settings.altFb = setYearBankKeep(ui.settings.altFb, YEAR, el.dataset.altfb, amountOf(el));
  else if (el.dataset.genutzt) ui.settings.genutzt = setYearBank(ui.settings.genutzt, YEAR, el.dataset.genutzt, amountOf(el));
  else if (el.dataset.vortragAktien || el.dataset.vortragAllg) {
    // Vortrag je Feld: gespeichert wird nur das Eingetippte, ein leeres Feld bleibt berechnet (keine Zahl aus der Datei).
    // Einträge anderer Jahre bleiben (sie wirken auf die Fortschreibung).
    const aktien = !!el.dataset.vortragAktien, key = aktien ? el.dataset.vortragAktien : el.dataset.vortragAllg;
    ui.settings.vortrag = setVortragField(ui.settings.vortrag, YEAR, key, aktien ? 'aktien' : 'allg', amountOf(el));
  } else return false;
  return true;
}

document.addEventListener('change', e => {
  const el = e.target;
  if (!ui.data) return;
  if (el.id === 's-veranl') ui.settings.veranlagung = el.value;
  else if (el.id === 's-land') ui.settings.bundesland = el.value;
  else if (el.id === 's-kist') ui.settings.kirchensteuer = el.checked;
  else if (el.id === 'p-fix' || el.id === 'p-pct') {
    const v = Math.max(0, +el.value.replace(',', '.') || 0);
    ui.settings[el.id === 'p-fix' ? 'gebuehrFix' : 'gebuehrProz'] = v;
    const t = $('#plan-target'); if (t) ui.target = t.value; // eingetipptes Ziel nicht verlieren
  }
  else if (el.dataset.ft) ui.settings.fundTypes = { ...ui.settings.fundTypes, [el.dataset.ft]: el.value };
  else if (bankSetting(el)) { save(); later(recalc); return; } // nur Verrechnung neu, kein FIFO-Neulauf
  else if (el.dataset.depot) {
    ui.depots = $$('[data-depot]').filter(x => x.checked).map(x => x.dataset.depot);
    if (!ui.depots.length) { el.checked = true; ui.depots = [el.dataset.depot]; }
    ui.settings.depotsOff = nextDepotsOff(ui.settings, ui.data.portfolios.map(p => p.uuid), ui.depots);
  } else return;
  save();
  later(recompute);
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
  const id = e.target.id, conf = e.target.closest && e.target.closest('[data-confirm]');
  if (ui.data && (conf || id === 'confirm-all')) {
    const secs = conf ? ui.data.securities.filter(x => x.uuid === conf.dataset.confirm) : tradedSecs();
    ui.settings.fundTypes = confirmFundTypes(ui.settings, secs);
    save(); recompute(); return;
  }
  if (id === 'csv-vp') download(`vorabpauschale-${TODAY}.csv`, csvVp(ui.result.vpRows, ui.data));
  else if (id === 'csv-fb') download(`freibetrag-${YEAR}.csv`, csvAllowance(ui.alloc, ui.data));
  else if (id === 'csv-alt') download(`altbestand-freibetrag-${YEAR}.csv`, csvAltFreibetrag(ui.altAlloc, ui.data));
  else if (id === 'csv-plan') download(`verkaufsplan-${TODAY}.csv`, csvPlan(ui.plan, ui.data));
});

// Aufgeklappte inaktive Banken bleiben beim Neuzeichnen offen
document.addEventListener('toggle', e => { if (e.target.id === 'banks-off') ui.banksOffOpen = e.target.open; }, true);

// Rechtsstand im Seitenkopf
$('#law-stand').textContent = `Stand ${fmtDate(LAW_STAND)}`;

// Hinweis einmal je Sitzung
try { if (sessionStorage.getItem(DISC_KEY)) $('#disclaimer').hidden = true; } catch { /* egal */ }
$('#disclaimer-close').addEventListener('click', () => { $('#disclaimer').hidden = true; try { sessionStorage.setItem(DISC_KEY, '1'); } catch { /* egal */ } });

// Theme-Wechsel und Größe
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);
new MutationObserver(renderCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
addEventListener('resize', () => $$('.chart').forEach(el => { const c = echarts.getInstanceByDom(el); if (c && !el.closest('[hidden]')) c.resize(); }));
