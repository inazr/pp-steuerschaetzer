// Verrechnungskern (Spec §4): Verlusttöpfe und Freistellungsaufträge. Reine Funktionen.
// Event = { year, date, owner, kind: 'aktie'|'sonst'|'div'|'vp'|'zins', amount }.

// Schritte 1–3: Aktiengewinne gegen Aktientopf, negative 'sonst' in den allgemeinen Topf,
// allgemeiner Topf mindert dann alle positiven Einkünfte (inkl. restlicher Aktiengewinne).
// byKind: Summen je Art; sonstGewinn / sonstVerlust als POSITIVE Beträge (Verlust als Betrag).
// rnd: Rundung der Ergebnisse (Standard Cent; der Verkaufsplan rechnet für seine Suche ungerundet mit x => x).
const EVENT_KINDS = new Set(['aktie', 'sonst', 'div', 'vp', 'zins']);
function netYear(pots, events, rnd = round2) {
  const by = { aktie: 0, sonstGewinn: 0, sonstVerlust: 0, div: 0, vp: 0, zins: 0 };
  for (const e of events) {
    if (!EVENT_KINDS.has(e.kind)) continue;   // unbekannte Art: ignorieren statt NaN
    if (e.kind === 'sonst') { if (e.amount < 0) by.sonstVerlust += -e.amount; else by.sonstGewinn += e.amount; }
    else by[e.kind] += e.amount;
  }
  // 1) Aktien: Töpfe sind Verlustbestände (positiv); Gewinn mindert, Verlust erhöht den Aktientopf
  let aktien = pots.aktien - by.aktie, aktGewinn = 0;
  if (aktien < 0) { aktGewinn = -aktien; aktien = 0; }   // Gewinn übersteigt den Topf
  // 2) allgemeiner Topf nimmt Verluste aus 'sonst' auf
  let allg = pots.allg + by.sonstVerlust;
  // 3) allgemeiner Topf mindert alle positiven Einkünfte
  let pos = aktGewinn + by.sonstGewinn + by.div + by.vp + by.zins;
  const use = Math.min(allg, Math.max(0, pos));
  pos -= use; allg -= use;
  return {
    positive: rnd(pos),
    potsAfter: { aktien: rnd(aktien), allg: rnd(allg) },
    byKind: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, rnd(v)])),
  };
}

// Freistellungsaufträge anwenden. Nicht pooled: je Bank eigener Auftrag; pooled: ein gemeinsamer
// Topf `spb`, in Reihenfolge der Schlüssel verteilt. rnd wie bei netYear.
function taxOf(positiveByBank, fsa, rate, rnd = round2) {
  const used = {}; let pool = fsa.spb, taxable = 0;
  for (const k of Object.keys(positiveByBank)) {
    const pos = Math.max(0, positiveByBank[k]);
    // gemeinsamer Topf: je Schritt gerundet, damit die genutzten Beträge zusammen nie über spb liegen
    const u = fsa.pooled ? rnd(Math.min(pool, pos)) : Math.min(fsa.byBank[k] ?? 0, pos);
    if (fsa.pooled) pool = rnd(pool - u);
    used[k] = rnd(u); taxable += pos - u;
  }
  taxable = rnd(taxable);
  return { usedByBank: used, taxable, tax: rnd(taxable * rate) };
}

// Bank-Zuordnung (Spec §3): [{ key, depots, accounts }]. Nur ausgewählte Depots; Konten folgen dem ersten
// ausgewählten Depot mit diesem Referenzkonto, lose Konten mit Zinsen gründen eine eigene Bank.
function bankMembers(data, settings) {
  const ports = data.portfolios || [], bankOf = settings.bankOf || {};
  // settings.depots fehlt (undefined) = alle Depots; ein leeres Array heißt wirklich „kein Depot“ (dann nur lose Konten).
  // Die Oberfläche übergibt nie ein leeres Array (selectedDepots fällt auf alle zurück).
  const sel = new Set(settings.depots || ports.map(p => p.uuid));
  const depots = ports.filter(p => sel.has(p.uuid));
  const refd = new Set(ports.map(p => p.accountUuid).filter(Boolean));
  const withInterest = new Set((data.interest || []).map(i => i.account));
  const loose = (data.accounts || []).filter(a => !refd.has(a.uuid) && withInterest.has(a.uuid));
  const base = new Set([...depots.map(p => p.uuid), ...loose.map(a => a.uuid)]);
  // Gründer: kein (gültiger) Eintrag in bankOf; Ziele müssen selbst Gründer sein
  const founder = k => !(bankOf[k] && bankOf[k] !== k && base.has(bankOf[k]));
  const target = k => founder(k) ? k : (founder(bankOf[k]) ? bankOf[k] : k);
  const banks = new Map();
  const bank = k => { if (!banks.has(k)) banks.set(k, { key: k, depots: [], accounts: [] }); return banks.get(k); };
  for (const k of base) if (founder(k)) bank(k);
  for (const p of depots) bank(target(p.uuid)).depots.push(p.uuid);
  const placed = new Set();
  const put = (acc, key) => { if (placed.has(acc)) return; placed.add(acc); bank(key).accounts.push(acc); };
  for (const p of depots) if (p.accountUuid) {
    const e = bankOf[p.accountUuid];
    put(p.accountUuid, e && base.has(e) && founder(e) ? e : target(p.uuid));
  }
  for (const a of loose) { const e = bankOf[a.uuid]; put(a.uuid, e && base.has(e) && founder(e) ? e : target(a.uuid)); }
  return [...banks.values()];
}
// Zinsen eines Kontos zählen: expliziter Schalter, sonst an genau dann, wenn ein ausgewähltes Depot es referenziert
function zinsOn(data, settings, accountUuid) {
  const z = (settings.zinsen || {})[accountUuid];
  if (typeof z === 'boolean') return z;
  const sel = new Set(settings.depots || (data.portfolios || []).map(p => p.uuid));
  return (data.portfolios || []).some(p => sel.has(p.uuid) && p.accountUuid === accountUuid);
}

// Ledger je Bank und Jahr (Spec §4). Töpfe laufen ab 2018 (bzw. ab dem ersten Ereignisjahr) bis `year`.
const POT_START = 2018;
const W_PRE2018 = 'Verluste aus 2009–2017 sind nicht berechnet – bitte als Vortrag zum 1.1. eintragen (Jahressteuerbescheinigung der Bank).';
const W_POOLED = 'Freistellungsaufträge je Bank eintragen, sonst stimmt der Abzug der einzelnen Bank nicht.';
const W_USED_POOLED = 'Eingetragene genutzte Beträge übersteigen den gemeinsamen Sparerpauschbetrag';
const bankLabel = (data, key) => ((data.portfolios || []).find(p => p.uuid === key) || (data.accounts || []).find(a => a.uuid === key) || {}).name || key;
// Vortrag-Override je Feld: nur eingetippte Zahlen ersetzen den berechneten Stand (null/fehlend = berechnet).
// Töpfe sind Verlustbestände: ein negativ eingetippter Wert zählt als 0.
const typedPot = v => typeof v === 'number' && isFinite(v);
const vortragTyped = o => !!o && (typedPot(o.aktien) || typedPot(o.allg));
const potField = (o, computed, f) => typedPot(o[f]) ? round2(Math.max(0, o[f])) : computed[f];
const mergePots = (o, computed) => ({ aktien: potField(o, computed, 'aktien'), allg: potField(o, computed, 'allg') });
const potsPositive = p => p.aktien > EPS || p.allg > EPS;
const lotsIn = (result, depots) => (result.lots || []).some(l => depots.includes(l.depot));

// FSA-Bestimmung für die Banken eines Jahres: banks = [{ key, active }]
function fsaConfig(banks, settings, year) {
  const spb = param('sparerpauschbetrag', year)[settings.veranlagung], fsaIn = settings.fsa || {};
  const entered = banks.some(b => typeof fsaIn[b.key] === 'number');
  const active = banks.filter(b => b.active);
  const pooled = !entered && active.length > 1;
  const byBank = {}, source = {};
  for (const b of banks) {
    if (entered) { byBank[b.key] = fsaIn[b.key] ?? 0; source[b.key] = typeof fsaIn[b.key] === 'number' ? 'eingetragen' : 'automatisch'; }
    else if (pooled) { byBank[b.key] = spb; source[b.key] = 'gemeinsam'; }
    else { byBank[b.key] = active.length === 1 && active[0].key === b.key ? spb : 0; source[b.key] = 'automatisch'; }
  }
  const fsaSum = pooled ? spb : round2(banks.reduce((s, b) => s + byBank[b.key], 0));
  return { spb, pooled, byBank, source, fsaSum };
}

// Eingabe für taxOf aus einer fsaConfig
const fsaOf = cfg => ({ pooled: cfg.pooled, spb: cfg.spb, byBank: cfg.byBank });

// Ereignisse je Bank: Mitglieder der Bank, Zinsen nur bei Schalter an
function bankEvents(result, data, settings, m) {
  const own = new Set([...m.depots, ...m.accounts.filter(a => zinsOn(data, settings, a))]);
  return (result.income || []).filter(e => own.has(e.owner));
}

function ledger(result, data, settings, year) {
  const warnings = [], rate = taxRate(settings, year);
  const rows = bankMembers(data, settings).map(m => {
    const evs = bankEvents(result, data, settings, m), label = bankLabel(data, m.key);
    // Töpfe bis zum 1.1. des Jahres fortschreiben (Ereignisse vor 2018 nie). Ein Vortrag-Override „y|key“ ersetzt
    // je eingetipptem Feld den Stand zum 1.1. jedes Jahres y (ab 2018); fortgeschrieben wird von dort aus.
    const vt = settings.vortrag || {}, ov = y => vortragTyped(vt[`${y}|${m.key}`]) ? vt[`${y}|${m.key}`] : null;
    const ovYears = Object.keys(vt).filter(k => k.slice(k.indexOf('|') + 1) === m.key).map(k => +k.slice(0, k.indexOf('|')))
      .filter(y => y >= POT_START && y <= year && ov(y));
    // Hinweis auf Verluste vor 2018 nur, solange die Bank keinen Vortrag (bis zum laufenden Jahr) eingetragen hat
    if (!ovYears.length && evs.some(e => e.year < POT_START && (e.kind === 'aktie' || e.kind === 'sonst'))) warnings.push(`${label}: ${W_PRE2018}`);
    const first = Math.max(POT_START, [...evs.map(e => e.year), ...ovYears].reduce((a, y) => Math.min(a, y), year));
    let pots = { aktien: 0, allg: 0 };
    for (let y = first; y < year; y++) {
      if (ov(y)) pots = mergePots(ov(y), pots);
      pots = netYear(pots, evs.filter(e => e.year === y)).potsAfter;
    }
    const vortragComputed = pots, o = ov(year);
    const potsStart = o ? mergePots(o, vortragComputed) : vortragComputed;
    const eventsYear = evs.filter(e => e.year === year), net = netYear(potsStart, eventsYear);
    const hasLots = lotsIn(result, m.depots);
    return { key: m.key, label, depots: m.depots, accounts: m.accounts,
      active: eventsYear.length > 0 || hasLots || potsPositive(potsStart),
      closedWithPot: !hasLots && potsPositive(net.potsAfter),
      vortragComputed, vortrag: potsStart, vortragOverridden: !!o, potsStart,
      eventsYear, income: net.byKind, positiveBase: net.positive, pots: net.potsAfter };
  });
  const cfg = fsaConfig(rows, settings, year);
  if (cfg.pooled) warnings.push(W_POOLED);
  if (cfg.fsaSum > cfg.spb + EPS)
    warnings.push(`Freistellungsaufträge übersteigen den Sparerpauschbetrag (${fmtEur(cfg.spb)})`);
  const genutzt = settings.genutzt || {};
  for (const b of rows) {
    b.fsa = cfg.byBank[b.key]; b.fsaSource = cfg.source[b.key];
    const ov = genutzt[`${year}|${b.key}`];
    b.usedOverridden = typeof ov === 'number';
    // Override < FSA: genau so viel positiv; Override ≥ FSA heißt „FSA voll genutzt“ – was darüber hinaus berechnet
    // ist, bleibt Bemessungsgrundlage (der Plan kann so auch jenseits des FSA versteuerte Erträge erstatten)
    b.positiveEff = !b.usedOverridden ? b.positiveBase : ov >= b.fsa ? Math.max(b.fsa, b.positiveBase) : round2(Math.max(0, ov));
  }
  // Gemeinsamer Modus: taxOf verteilt den spb in Schlüsselreihenfolge und kürzt so still – darauf hinweisen
  const typedUsed = rows.filter(b => b.usedOverridden).reduce((s, b) => s + Math.max(0, genutzt[`${year}|${b.key}`]), 0);
  if (cfg.pooled && typedUsed > cfg.spb + EPS) warnings.push(W_USED_POOLED);
  const fsa = fsaOf(cfg);
  const base = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positiveBase])), fsa, rate).usedByBank;
  const eff = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positiveEff])), fsa, rate).usedByBank;
  // Gemeinsamer Modus: fsa = gemeinsamer spb je Bank, fsaLeft = Rest des gemeinsamen Topfs (auf jeder Bank dieselbe Zahl)
  const poolLeft = round2(Math.max(0, cfg.spb - Object.values(eff).reduce((s, u) => s + u, 0)));
  for (const b of rows) {
    b.usedComputed = base[b.key]; b.used = eff[b.key];
    b.fsaLeft = cfg.pooled ? poolLeft : round2(Math.max(0, b.fsa - b.used));
  }
  return { banks: rows, pooled: cfg.pooled, fsaSum: cfg.fsaSum, spb: cfg.spb, fsa, rate, warnings };
}

// Vorschau Folgejahr: nur die prognostizierte VP (Ertrag am 02.01.), Töpfe zum Jahresende `year`
function ledgerNextYear(result, data, settings, year) {
  const next = year + 1, cur = ledger(result, data, settings, year), rate = taxRate(settings, next);
  const vp = (result.vpForecast || []).filter(r => r.taxable > 0)
    .map(r => ({ year: next, date: `${next}-01-02`, owner: r.depot, kind: 'vp', amount: round2(r.taxable) }));
  const rows = cur.banks.map(b => {
    const evs = vp.filter(e => b.depots.includes(e.owner));
    return { key: b.key, label: b.label, active: evs.length > 0 || lotsIn(result, b.depots) || potsPositive(b.pots),
      positive: netYear(b.pots, evs).positive };
  });
  const cfg = fsaConfig(rows, settings, next);
  const t = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positive])), fsaOf(cfg), rate);
  const used = round2(Object.values(t.usedByBank).reduce((s, u) => s + u, 0));
  const banks = rows.map(b => ({ key: b.key, label: b.label, fsa: cfg.byBank[b.key], used: t.usedByBank[b.key],
    fsaLeft: cfg.pooled ? round2(Math.max(0, cfg.spb - used)) : round2(Math.max(0, cfg.byBank[b.key] - t.usedByBank[b.key])) }));
  // Mehr als der Sparerpauschbetrag ist nie frei, auch wenn die eingetragenen Aufträge zusammen darüber liegen
  const total = Math.min(cfg.fsaSum, cfg.spb);
  return { year: next, banks, pooled: cfg.pooled, total, used, remaining: round2(Math.max(0, total - used)), taxAfter: t.tax };
}

// Override-Schlüssel des 100.000-€-Freibetrags: `Jahr|sortierte Depot-UUIDs` = verbleibend zum 31.12. Jahr−1
const altFbSel = depots => (depots || []).slice().sort().join(',');
const altFbParse = k => { const i = k.indexOf('|'), y = +k.slice(0, i); return i > 0 && Number.isInteger(y) ? { year: y, sel: k.slice(i + 1) } : null; };
// Jüngster Override für diese Auswahl mit Jahr ≤ year: { year, value } oder null
function altFbOverride(altFb, sel, year) {
  let best = null;
  for (const [k, v] of Object.entries(altFb || {})) {
    const p = altFbParse(k);
    if (!p || p.sel !== sel || p.year > year || typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (!best || p.year > best.year) best = { year: p.year, value: v };
  }
  return best;
}
// Gibt es einen Override für eine andere Depotauswahl? (Hinweis in der Übersicht)
const altFbOtherSelection = (altFb, sel) => Object.keys(altFb || {}).some(k => { const p = altFbParse(k); return !!p && p.sel !== sel; });

// 100.000-€-Freibetrag für Fondsanteile vor 2009 (§ 56 Abs. 6 InvStG) und erwartete Erstattung.
// Override: verbleibender Freibetrag laut Bescheid zum 31.12. Y−1 (Schlüssel `Y|Depots`, s. altFbOverride); der jüngste
// Override mit Y ≤ year gilt, fortgeschrieben um die alt100k-Posten der Auswahl in Y … year−1.
function altFreibetrag(result, data, settings, year, led) {
  const joint = settings.veranlagung === 'joint', total = (joint ? 2 : 1) * param('altFreibetrag', year);
  const sel = settings.depots;
  const items = (result.veranlagung || []).filter(v => !sel || sel.includes(v.depot));
  const sum = xs => xs.reduce((s, v) => s + v.amount, 0);
  const alt = items.filter(v => v.kind === 'alt100k');
  const leftStartComputed = Math.max(0, total - sum(alt.filter(v => v.year >= 2018 && v.year < year)));
  const ov = altFbOverride(settings.altFb, altFbSel(sel), year);
  const leftStartOverridden = !!ov, leftStartFrom = ov ? ov.year : null;
  const leftStart = ov ? Math.min(total, Math.max(0, ov.value - sum(alt.filter(v => v.year >= ov.year && v.year < year)))) : leftStartComputed;
  const thisYear = alt.filter(v => v.year === year).sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  const usedThisYear = sum(thisYear);
  const left = Math.max(0, leftStart - usedThisYear);
  const cap = led.banks.reduce((s, b) => s + Math.max(0, b.positiveEff - b.used), 0);
  const bfh = sum(items.filter(v => v.kind === 'bfh' && v.year === year));
  const r = altRefunds(led.rate, cap, leftStart, thisYear, bfh);
  // yearAlt100k/yearBfh: Posten des Jahres für den Verkaufsplan, der seine Planzeilen anhängt
  return { total, joint, leftStartComputed, leftStart, leftStartOverridden, leftStartFrom, usedThisYear, left,
    refund100k: round2(r.refund100k), refundBfh: round2(r.refundBfh), yearAlt100k: thisYear, yearBfh: bfh };
}

// Übersicht: 'full' = Karte Altbestand-Freibetrag (Fondsanteile vor 2009 im Bestand oder ab 2018 schon Gewinne daraus
// in der Auswahl), 'bfh' = nur die erwartete BFH-Erstattung (Altanteile 2009–2017 mit Fiktionsverlust), '' = nichts
function altCardMode(result, depots, a) {
  const pre = (result.lots || []).some(l => l.alt && l.alt.pre2009)
    || (result.veranlagung || []).some(v => v.kind === 'alt100k' && (!depots || depots.includes(v.depot)));
  return pre ? 'full' : a.refundBfh > 0.005 ? 'bfh' : '';
}

// Erwartete Erstattungen eines Jahres (Annahme A), ungerundet: alt100k-Posten { amount, tfs } in Datumsreihenfolge gegen
// den Rest ab leftStart (frei100k = Σ min(Rest, amount) × (1 − tfs)), danach die BFH-Posten (Summe bfh); beides zusammen
// höchstens bis zur im Jahr besteuerten Bemessungsgrundlage cap.
function altRefunds(rate, cap, leftStart, alt100k, bfh) {
  let rest = leftStart, frei100k = 0;
  for (const v of alt100k) { const u = Math.min(rest, v.amount); frei100k += u * (1 - v.tfs); rest -= u; }
  return { refund100k: rate * Math.min(cap, frei100k), refundBfh: rate * Math.min(Math.max(0, cap - frei100k), bfh) };
}
