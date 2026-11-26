// Sparerpauschbetrag ausnutzen: welche Lots verkaufen (und sofort zurückkaufen), damit steuerpflichtige Gewinne
// genau den freien Betrag füllen. Je Depot × Wertpapier darf nur in FIFO-Reihenfolge verkauft werden.
const floor8 = x => Math.floor(x * 1e8 + 1e-6) / 1e8;

// Steuerpflichtiger Gewinn je Stück; null = Lot ist steuerfrei (Bestandsschutz)
function taxableGainPerShare(lot, price, settings, data) {
  const sec = data.securities.find(s => s.uuid === lot.security);
  const ft = FUND_TYPES[fundTypeOf(settings, sec)];
  if (ft.bestandsschutz && lot.buyDate < ft.bestandsschutz) return null;
  return gainParts(lot, price, ft).taxable;
}

// Offene Lots je Depot × Wertpapier in FIFO-Reihenfolge
function fifoQueues(lots) {
  const m = new Map();
  for (const l of lots) { const k = l.depot + '|' + l.security; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
  return [...m.values()];
}

// Je aktiver Bank ein Greedy-Durchlauf (höchster stpfl. Gewinn je Stück an den FIFO-Spitzen der Bank-Depots).
// Ein Gewinn verbraucht bei Einzelaktien erst den Aktientopf, dann den allgemeinen Topf, dann den Freistellungsauftrag;
// sonst allgemeiner Topf, dann FSA. Gemeinsamer Modus: ein gemeinsamer FSA-Rest über alle Banken (Töpfe je Bank).
// leftStart je Bank: freier FSA zu Beginn ihres Durchlaufs (gemeinsam: was frühere Banken übrig ließen).
function optimizeAllowance(result, data, settings, year) {
  const led = ledger(result, data, settings, year), active = led.banks.filter(b => b.active);
  // Spec §4a: Fonds-Lots vor 2009 sind über den 100.000-€-Freibetrag ohnehin frei, solange er reicht – sie gehören in den
  // Abschnitt „Altbestand-Freibetrag nutzen“; als FIFO-Spitze blockieren sie ihre Queue wie ein Bestandsschutz-Lot
  const altFree = altFreibetrag(result, data, settings, year, led).left >= 0.01;
  let poolLeft = led.banks.length ? led.banks[0].fsaLeft : 0, altSkipped = false;
  const banks = [], rows = [];
  for (const b of active) {
    const st = { aktien: b.pots.aktien, allg: b.pots.allg };
    let left = led.pooled ? poolLeft : b.fsaLeft;
    const leftStart = left;
    const start = { ...st }, potsUsed = { aktien: 0, allg: 0 }, brows = [];
    const lots = (result.lots || []).filter(l => b.depots.includes(l.depot));
    const heads = fifoQueues(lots).map(q => ({ lots: q, i: 0, left: q[0].shares, price: (result.latest.get(q[0].security) || [])[1] }))
      .filter(h => h.price > 0);
    // Hinweis in Reiter 3: Queues mit einem Vor-2009-Lot vorn bleiben hier außen vor (s. „Altbestand-Freibetrag nutzen“)
    if (altFree && heads.some(h => h.lots[0].alt && h.lots[0].alt.pre2009)) altSkipped = true;
    while (left >= 0.01) {
      let best = null, bestGain = 0;
      for (const h of heads) {
        if (h.i >= h.lots.length) continue;
        if (altFree && h.lots[h.i].alt && h.lots[h.i].alt.pre2009) continue;
        const gain = taxableGainPerShare(h.lots[h.i], h.price, settings, data);
        if (gain !== null && gain > bestGain) { best = h; bestGain = gain; }
      }
      if (!best) break;
      const lot = best.lots[best.i];
      const stock = fundTypeOf(settings, data.securities.find(s => s.uuid === lot.security)) === 'einzelaktie';
      const cap = (stock ? st.aktien : 0) + st.allg + left;
      const n = Math.min(best.left, floor8(cap / bestGain));
      if (n <= 0) break;
      const gainTaxable = round2(n * bestGain);
      let g = gainTaxable;
      if (stock) { const a = Math.min(st.aktien, g); st.aktien = round2(st.aktien - a); potsUsed.aktien = round2(potsUsed.aktien + a); g -= a; }
      const c = Math.min(st.allg, g); st.allg = round2(st.allg - c); potsUsed.allg = round2(potsUsed.allg + c); g -= c;
      left = round2(Math.max(0, left - g));
      brows.push({ bank: b.key, lot, shares: n, price: best.price, gross: round2(n * best.price), gainTaxable });
      best.left = round8(best.left - n);
      if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
      else break; // Freibetrag/Topf ist ausgeschöpft
    }
    if (led.pooled) poolLeft = left;
    const hint = start.allg > 0 ? `Verluste von ${fmtEur(start.allg)} werden zuerst verrechnet. Alternative: bis 15.12. Verlustbescheinigung beantragen, dann wirkt der Freistellungsauftrag sofort.` : '';
    banks.push({ key: b.key, label: b.label, fsa: b.fsa, used: b.used, fsaLeft: b.fsaLeft, potsStart: start, rows: brows,
      harvested: round2(brows.reduce((s, r) => s + r.gainTaxable, 0)), potsUsed, fsaUsed: round2(leftStart - left), leftStart, hint });
    rows.push(...brows);
  }
  const total = led.pooled ? led.spb : round2(active.reduce((s, b) => s + b.fsa, 0));
  const used = round2(active.reduce((s, b) => s + b.used, 0));
  const remaining = led.pooled ? round2(Math.max(0, led.spb - used)) : round2(active.reduce((s, b) => s + b.fsaLeft, 0));
  // gemeinsamer Modus: taxOf rundet den Topf je Schritt, die genutzten Beträge liegen zusammen nie über spb
  return { banks, pooled: led.pooled, total, used, remaining, rows, harvested: round2(rows.reduce((s, r) => s + r.gainTaxable, 0)), altSkipped };
}

// Abschnitt „Altbestand-Freibetrag nutzen“ (Spec §4): Fonds-Lots vor 2009 an den FIFO-Spitzen verkaufen (und zurückkaufen),
// bis der Rest des 100.000-€-Freibetrags (left, Gewinn vor TFS) gefüllt ist. Läuft nach dem FSA-Vorschlag `alloc`: dessen
// Stücke sind verbraucht, seine Gewinne stehen schon im Jahr der Bank. bankTax = ΔSteuer wie im Planer (netYear/taxOf je
// Bank, Jahressaldo gegen den Stand nach dem Vorschlag); refund = erwartete Erstattung (altRefunds wie altFreibetrag,
// Δ je Zeile), höchstens der Bankabzug der Zeile.
const ALT_HINT = 'Die Bank behält Steuer ein; sie kommt über die Steuererklärung (Anlage KAP-INV) zurück, frühestens mit dem Steuerbescheid. Bis dahin fehlt das Geld. Lohnt sich vor allem bei hohen Gewinnen; Ordergebühren und Spread beachten.';
function optimizeAltFreibetrag(result, data, settings, year, alloc) {
  const led = ledger(result, data, settings, year), rate = led.rate;
  const af = altFreibetrag(result, data, settings, year, led), left = af.left;
  const bankOf = new Map(led.banks.flatMap(b => b.depots.map(d => [d, b])));
  const lots = (result.lots || []).filter(l => bankOf.has(l.depot));
  // banks: Labels aus dem Ledger für den CSV-Export (csvBank wie beim FSA-Vorschlag und Verkaufsplan)
  const banks = led.banks.map(b => ({ key: b.key, label: b.label }));
  const empty = hint => ({ left, rows: [], harvested: 0, bankTax: 0, refund: 0, hint, banks });
  if (!lots.some(l => l.alt && l.alt.pre2009)) return empty('Kein Fonds-Altbestand von vor 2009 im Bestand.');
  if (left < 0.01) return empty('Der Altbestand-Freibetrag ist bereits ausgeschöpft.');

  // Jahr je Bank mit den Zeilen des FSA-Vorschlags als Ereignisse
  const secOf = lot => data.securities.find(s => s.uuid === lot.security);
  const kindOf = lot => fundTypeOf(settings, secOf(lot)) === 'einzelaktie' ? 'aktie' : 'sonst';
  const planned = new Map(led.banks.map(b => [b.key, []]));
  const usedShares = new Map();
  for (const r of (alloc && alloc.rows) || []) {
    usedShares.set(r.lot, (usedShares.get(r.lot) || 0) + r.shares);
    const b = bankOf.get(r.lot.depot);
    if (b) planned.get(b.key).push({ kind: kindOf(r.lot), amount: r.gainTaxable });
  }
  const basePos = new Map(led.banks.map(b => [b.key, netYear(b.potsStart, b.eventsYear).positive]));
  const posOf = () => Object.fromEntries(led.banks.map(b =>
    [b.key, b.positiveEff + netYear(b.potsStart, b.eventsYear.concat(planned.get(b.key))).positive - basePos.get(b.key)]));
  let cur = taxOf(posOf(), led.fsa, rate);
  const planAlt = [];
  const refundAt = cap => { const x = altRefunds(rate, cap, af.leftStart, af.yearAlt100k.concat(planAlt), af.yearBfh); return x.refund100k + x.refundBfh; };
  let refundCur = refundAt(cur.taxable);

  // FIFO-Spitzen nach Abzug der Stücke des Vorschlags
  const heads = fifoQueues(lots).map(q => {
    let i = 0, rest = q[0].shares - (usedShares.get(q[0]) || 0);
    while (rest <= EPS && ++i < q.length) rest = q[i].shares - (usedShares.get(q[i]) || 0);
    return { lots: q, i, left: round8(rest), price: (result.latest.get(q[0].security) || [])[1] };
  }).filter(h => h.price > 0 && h.i < h.lots.length);
  const rawOf = h => {
    const lot = h.lots[h.i];
    return lot.alt && lot.alt.pre2009 ? gainParts(lot, h.price, FUND_TYPES[fundTypeOf(settings, secOf(lot))]) : null;
  };

  const rows = [];
  let rem = left;
  while (rem >= 0.01) {
    let best = null, bp = null;
    for (const h of heads) {
      if (h.i >= h.lots.length) continue;
      const gp = rawOf(h);
      if (gp && gp.raw > 0 && (!bp || gp.raw > bp.raw)) { best = h; bp = gp; }
    }
    if (!best) break;
    const lot = best.lots[best.i], b = bankOf.get(lot.depot);
    const n = Math.min(best.left, floor8(rem / bp.raw));
    if (n <= 0) break;
    const raw = round2(n * bp.raw), tfs = FUND_TYPES[fundTypeOf(settings, secOf(lot))].tfs;
    planned.get(b.key).push({ kind: 'sonst', amount: n * bp.taxable });
    planAlt.push({ amount: raw, tfs });
    const next = taxOf(posOf(), led.fsa, rate), refundNext = refundAt(next.taxable);
    const bankTax = round2(Math.max(0, next.tax - cur.tax));
    rows.push({ lot, bank: b.key, shares: n, price: best.price, gross: round2(n * best.price), raw, bankTax,
      refund: round2(Math.min(bankTax, Math.max(0, refundNext - refundCur))) });
    cur = next; refundCur = refundNext;
    rem = round2(rem - raw);
    best.left = round8(best.left - n);
    if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
    else break; // Freibetrag ist gefüllt
  }
  const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
  return { left, rows, harvested: sum('raw'), bankTax: sum('bankTax'), refund: sum('refund'),
    hint: rows.length ? ALT_HINT : 'Keine Fonds-Lots von vor 2009 mit Gewinn an der FIFO-Spitze.', banks };
}

// Dezember-Effekt (§ 18 Abs. 2 InvStG): Verkauf + Rückkauf im Monat m → die zurückgekauften Anteile tragen nur (13 − m)/12 der
// Vorabpauschale des laufenden Jahres. Sie fließt am 02.01. des Folgejahres zu, also bleibt dort mehr Freistellungsauftrag frei.
// rows: [{ lot, shares }] (Zeilen der Vorschläge). Rechnet mit der Prognose je Lot aus replay, keine eigene Formel.
function decemberEffect(result, data, settings, year, rows, today) {
  const lots = new Map((result.vpForecastLots || []).map(f => [f.lotId, f]));
  if (!(result.vpForecast || []).length || !lots.size) return { months: [] };
  const shares = new Map();
  for (const r of rows || []) if (r.lot && lots.has(r.lot.id)) shares.set(r.lot.id, (shares.get(r.lot.id) || 0) + r.shares);
  const vpBefore = round2(result.vpForecast.reduce((s, r) => s + r.vp, 0));
  const taxableByDepot = {};
  for (const r of result.vpForecast) taxableByDepot[r.depot] = (taxableByDepot[r.depot] || 0) + r.taxable;
  const base = ledgerNextYear(result, data, settings, year);
  const start = +today.slice(0, 4) === year ? +today.slice(5, 7) : 1;
  const months = [];
  for (let m = start; m <= 12; m++) {
    let gross = 0, taxable = 0;
    const redByDepot = {};
    for (const [id, n] of shares) {
      const f = lots.get(id), red = Math.max(0, f.vpPS - f.vpFullPS * (13 - m) / 12) * n;
      gross += red; taxable += red * (1 - f.tfs);
      redByDepot[f.depot] = (redByDepot[f.depot] || 0) + red * (1 - f.tfs);
    }
    const vpForecast = Object.entries(taxableByDepot).map(([depot, t]) => ({ depot, taxable: round2(Math.max(0, t - (redByDepot[depot] || 0))) }));
    const after = ledgerNextYear({ ...result, vpForecast }, data, settings, year);
    months.push({ month: m, vpBefore, vpAfter: round2(vpBefore - gross), taxableReduction: round2(taxable),
      taxSaved: round2(Math.max(0, base.taxAfter - after.taxAfter)),
      next: { remainingBefore: base.remaining, remainingAfter: after.remaining,
        banks: base.banks.map(b => ({ key: b.key, label: b.label, before: b.fsaLeft, after: (after.banks.find(x => x.key === b.key) || {}).fsaLeft })) } });
  }
  return { months };
}
