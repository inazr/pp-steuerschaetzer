// Verrechnungskern (Spec §4): Verlusttöpfe und Freistellungsaufträge. Reine Funktionen.
// Event = { year, date, owner, kind: 'aktie'|'sonst'|'div'|'vp'|'zins', amount }.

// Schritte 1–3: Aktiengewinne gegen Aktientopf, negative 'sonst' in den allgemeinen Topf,
// allgemeiner Topf mindert dann alle positiven Einkünfte (inkl. restlicher Aktiengewinne).
// byKind: Summen je Art; sonstGewinn / sonstVerlust als POSITIVE Beträge (Verlust als Betrag).
// rnd: Rundung der Ergebnisse (Standard Cent; der Verkaufsplan rechnet für seine Suche ungerundet mit x => x).
function netYear(pots, events, rnd = round2) {
  const by = { aktie: 0, sonstGewinn: 0, sonstVerlust: 0, div: 0, vp: 0, zins: 0 };
  for (const e of events) {
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
    const u = fsa.pooled ? Math.min(pool, pos) : Math.min(fsa.byBank[k] ?? 0, pos);
    if (fsa.pooled) pool -= u;
    used[k] = rnd(u); taxable += pos - u;
  }
  taxable = rnd(taxable);
  return { usedByBank: used, taxable, tax: rnd(taxable * rate) };
}

// Bank-Zuordnung (Spec §3): [{ key, depots, accounts }]. Nur ausgewählte Depots; Konten folgen dem ersten
// ausgewählten Depot mit diesem Referenzkonto, lose Konten mit Zinsen gründen eine eigene Bank.
function bankMembers(data, settings) {
  const ports = data.portfolios || [], bankOf = settings.bankOf || {};
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
const bankLabel = (data, key) => ((data.portfolios || []).find(p => p.uuid === key) || (data.accounts || []).find(a => a.uuid === key) || {}).name || key;
const asPots = o => ({ aktien: round2(+o.aktien || 0), allg: round2(+o.allg || 0) });
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

// Ereignisse je Bank: Mitglieder der Bank, Zinsen nur bei Schalter an
function bankEvents(result, data, settings, m) {
  const own = new Set([...m.depots, ...m.accounts.filter(a => zinsOn(data, settings, a))]);
  return (result.income || []).filter(e => own.has(e.owner));
}

function ledger(result, data, settings, year) {
  const warnings = [], rate = taxRate(settings, year);
  const rows = bankMembers(data, settings).map(m => {
    const evs = bankEvents(result, data, settings, m), label = bankLabel(data, m.key);
    if (evs.some(e => e.year < POT_START && (e.kind === 'aktie' || e.kind === 'sonst'))) warnings.push(`${label}: ${W_PRE2018}`);
    // Töpfe bis zum 1.1. des Jahres fortschreiben (Ereignisse vor 2018 nie). Ein Vortrag-Override „y|key“ ersetzt
    // den Stand zum 1.1. jedes Jahres y (ab 2018); fortgeschrieben wird von dort aus.
    const vt = settings.vortrag || {}, ov = y => vt[`${y}|${m.key}`];
    const ovYears = Object.keys(vt).filter(k => k.slice(k.indexOf('|') + 1) === m.key).map(k => +k.slice(0, k.indexOf('|')))
      .filter(y => y >= POT_START && y < year);
    const first = Math.max(POT_START, [...evs.map(e => e.year), ...ovYears].reduce((a, y) => Math.min(a, y), year));
    let pots = { aktien: 0, allg: 0 };
    for (let y = first; y < year; y++) {
      if (ov(y)) pots = asPots(ov(y));
      pots = netYear(pots, evs.filter(e => e.year === y)).potsAfter;
    }
    const vortragComputed = pots, o = ov(year);
    const potsStart = o ? asPots(o) : vortragComputed;
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
    b.positiveEff = b.usedOverridden ? round2(Math.min(b.fsa, Math.max(0, ov))) : b.positiveBase;
  }
  const fsa = { pooled: cfg.pooled, spb: cfg.spb, byBank: cfg.byBank };
  const base = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positiveBase])), fsa, rate).usedByBank;
  const eff = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positiveEff])), fsa, rate).usedByBank;
  // Gemeinsamer Modus: fsa = gemeinsamer spb je Bank, fsaLeft = Rest des gemeinsamen Topfs (auf jeder Bank dieselbe Zahl)
  const poolLeft = round2(Math.max(0, cfg.spb - Object.values(eff).reduce((s, u) => s + u, 0)));
  for (const b of rows) {
    b.usedComputed = base[b.key]; b.used = eff[b.key];
    b.fsaLeft = cfg.pooled ? poolLeft : round2(Math.max(0, b.fsa - b.used));
  }
  return { banks: rows, pooled: cfg.pooled, fsaSum: cfg.fsaSum, spb: cfg.spb, rate, warnings };
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
  const t = taxOf(Object.fromEntries(rows.map(b => [b.key, b.positive])), { pooled: cfg.pooled, spb: cfg.spb, byBank: cfg.byBank }, rate);
  const used = round2(Object.values(t.usedByBank).reduce((s, u) => s + u, 0));
  const banks = rows.map(b => ({ key: b.key, label: b.label, fsa: cfg.byBank[b.key], used: t.usedByBank[b.key],
    fsaLeft: cfg.pooled ? round2(Math.max(0, cfg.spb - used)) : round2(Math.max(0, cfg.byBank[b.key] - t.usedByBank[b.key])) }));
  return { year: next, banks, pooled: cfg.pooled, total: cfg.fsaSum, used, remaining: round2(Math.max(0, cfg.fsaSum - used)), taxAfter: t.tax };
}
