// Sparerpauschbetrag ausnutzen: welche Lots verkaufen (und sofort zurückkaufen), damit steuerpflichtige Gewinne
// genau den freien Betrag füllen. Je Depot × Wertpapier darf nur in FIFO-Reihenfolge verkauft werden.
const floor8 = x => Math.floor(x * 1e8 + 1e-6) / 1e8;

// Bereits genutzt: steuerpflichtige VP des Vorjahres (fließt im Januar zu) + Ausschüttungen und realisierte Gewinne des Jahres,
// jeweils nur der ausgewählten Depots
function prefillUsed(result, settings, year) {
  const spb = param('sparerpauschbetrag', year)[settings.veranlagung];
  const vp = result.vpTaxableByYear[year - 1] || 0;
  const dist = (result.distributions || {})[year] || 0;
  return round2(Math.min(spb, Math.max(0, vp + dist + (result.realized[year] || 0))));
}

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

function optimizeAllowance(result, data, settings, year) {
  const total = param('sparerpauschbetrag', year)[settings.veranlagung];
  const used = settings.genutzt ?? prefillUsed(result, settings, year);
  const remaining = round2(Math.max(0, total - used));
  const heads = fifoQueues(result.lots).map(lots => ({ lots, i: 0, left: lots[0].shares, price: (result.latest.get(lots[0].security) || [])[1] }))
    .filter(h => h.price > 0);
  const rows = [];
  let left = remaining;
  while (left >= 0.01) {
    let best = null, bestGain = 0;
    for (const h of heads) {
      if (h.i >= h.lots.length) continue;
      const gain = taxableGainPerShare(h.lots[h.i], h.price, settings, data);
      if (gain !== null && gain > bestGain) { best = h; bestGain = gain; }
    }
    if (!best) break;
    const lot = best.lots[best.i];
    const n = Math.min(best.left, floor8(left / bestGain));
    if (n <= 0) break;
    const gainTaxable = round2(n * bestGain);
    rows.push({ lot, shares: n, price: best.price, gross: round2(n * best.price), gainTaxable });
    left = round2(left - gainTaxable);
    best.left = round8(best.left - n);
    if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
    else break; // Freibetrag ist ausgeschöpft
  }
  return { total, used, remaining, rows, harvested: round2(rows.reduce((s, r) => s + r.gainTaxable, 0)) };
}
