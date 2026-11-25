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
