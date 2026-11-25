// Verrechnungskern (Spec §4): Verlusttöpfe und Freistellungsaufträge. Reine Funktionen.
// Event = { year, date, owner, kind: 'aktie'|'sonst'|'div'|'vp'|'zins', amount }.

// Schritte 1–3: Aktiengewinne gegen Aktientopf, negative 'sonst' in den allgemeinen Topf,
// allgemeiner Topf mindert dann alle positiven Einkünfte (inkl. restlicher Aktiengewinne).
// byKind: Summen je Art; sonstGewinn / sonstVerlust als POSITIVE Beträge (Verlust als Betrag).
function netYear(pots, events) {
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
    positive: round2(pos),
    potsAfter: { aktien: round2(aktien), allg: round2(allg) },
    byKind: Object.fromEntries(Object.entries(by).map(([k, v]) => [k, round2(v)])),
  };
}

// Freistellungsaufträge anwenden. Nicht pooled: je Bank eigener Auftrag; pooled: ein gemeinsamer
// Topf `spb`, in Reihenfolge der Schlüssel verteilt.
function taxOf(positiveByBank, fsa, rate) {
  const used = {}; let pool = fsa.spb, taxable = 0;
  for (const k of Object.keys(positiveByBank)) {
    const pos = Math.max(0, positiveByBank[k]);
    const u = fsa.pooled ? Math.min(pool, pos) : Math.min(fsa.byBank[k] ?? 0, pos);
    if (fsa.pooled) pool -= u;
    used[k] = round2(u); taxable += pos - u;
  }
  taxable = round2(taxable);
  return { usedByBank: used, taxable, tax: round2(taxable * rate) };
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
