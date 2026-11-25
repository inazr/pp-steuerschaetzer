// Sparerpauschbetrag ausnutzen: welche Lots verkaufen (und sofort zurückkaufen), damit steuerpflichtige Gewinne
// genau den freien Betrag füllen. Je Depot × Wertpapier darf nur in FIFO-Reihenfolge verkauft werden.
const floor8 = x => Math.floor(x * 1e8 + 1e-6) / 1e8;

// Steuerpflichtiger Gewinn je Stück; null = Lot ist steuerfrei (Bestandsschutz)
function taxableGainPerShare(lot, price, settings, data) {
  const sec = data.securities.find(s => s.uuid === lot.security);
  const ft = FUND_TYPES[fundTypeOf(settings, sec)];
  if (ft.bestandsschutz && lot.buyDate < ft.bestandsschutz) return null;
  return (price - lot.cost - lot.vpCum / lot.shares) * (1 - ft.tfs);
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
function optimizeAllowance(result, data, settings, year) {
  const led = ledger(result, data, settings, year), active = led.banks.filter(b => b.active);
  let poolLeft = led.banks.length ? led.banks[0].fsaLeft : 0;
  const banks = [], rows = [];
  for (const b of active) {
    const st = { aktien: b.pots.aktien, allg: b.pots.allg };
    let left = led.pooled ? poolLeft : b.fsaLeft;
    const leftStart = left;
    const start = { ...st }, potsUsed = { aktien: 0, allg: 0 }, brows = [];
    const lots = (result.lots || []).filter(l => b.depots.includes(l.depot));
    const heads = fifoQueues(lots).map(q => ({ lots: q, i: 0, left: q[0].shares, price: (result.latest.get(q[0].security) || [])[1] }))
      .filter(h => h.price > 0);
    while (left >= 0.01) {
      let best = null, bestGain = 0;
      for (const h of heads) {
        if (h.i >= h.lots.length) continue;
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
      harvested: round2(brows.reduce((s, r) => s + r.gainTaxable, 0)), potsUsed, fsaUsed: round2(leftStart - left), hint });
    rows.push(...brows);
  }
  const total = led.pooled ? led.spb : round2(active.reduce((s, b) => s + b.fsa, 0));
  const used = round2(active.reduce((s, b) => s + b.used, 0));
  const remaining = led.pooled ? round2(Math.max(0, led.spb - used)) : round2(active.reduce((s, b) => s + b.fsaLeft, 0));
  return { banks, pooled: led.pooled, total, used: led.pooled ? Math.min(used, led.spb) : used, remaining, rows, harvested: round2(rows.reduce((s, r) => s + r.gainTaxable, 0)) };
}
