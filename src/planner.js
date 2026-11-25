// „Ich brauche X € netto“: verkauft FIFO je Depot × Wertpapier, wählt dabei immer den Lot mit der geringsten
// Steuer je Euro netto. Freibetrag wird in Verkaufsreihenfolge verbraucht, Verluste werden nicht verrechnet.
// Zwei Durchläufe: mit Bewertung der Fixgebühr (weniger Orders) und ohne (wie bis 0.2). Behalten wird der Plan mit
// den geringeren Kosten (Gebühren + Steuer); so wird die Gebührenbewertung nie teurer als die reine Steuer-Reihenfolge.
function planNetSale(result, data, settings, year, target) {
  const a = runNetSale(result, data, settings, year, target, true), b = runNetSale(result, data, settings, year, target, false);
  if (a.reached !== b.reached) return a.reached ? a : b;
  return b.fees + b.tax < a.fees + a.tax - 0.005 ? b : a;
}

function runNetSale(result, data, settings, year, target, feeAware) {
  const total = param('sparerpauschbetrag', year)[settings.veranlagung];
  const used = settings.genutzt ?? prefillUsed(result, settings, year);
  let allowLeft = Math.max(0, total - used);
  const rate = taxRate(settings, year);
  // Ordergebühren: fester Betrag je Order (= erster Verkauf je Depot × Wertpapier) plus Prozent vom Erlös
  const feeFix = Math.max(0, +settings.gebuehrFix || 0), feePct = Math.max(0, +settings.gebuehrProz || 0) / 100;
  const heads = fifoQueues(result.lots).map(lots => ({ lots, i: 0, left: lots[0].shares, price: (result.latest.get(lots[0].security) || [])[1], ordered: false }))
    .filter(h => h.price > 0);
  const tfsOf = lot => FUND_TYPES[fundTypeOf(settings, data.securities.find(s => s.uuid === lot.security))].tfs;
  const info = h => {
    const lot = h.lots[h.i], a = h.price * (1 - feePct); // Erlös je Stück nach Prozentgebühr
    const g = taxableGainPerShare(lot, a, settings, data);
    const taxablePS = g === null ? 0 : Math.max(0, g);
    return { lot, a, exempt: g === null, taxablePS, ratio: taxablePS * rate / (a - taxablePS * rate) };
  };
  // Ein Verkaufsschritt dieses Kopfes für den aktuellen Restbedarf
  const step = (h, x) => {
    const { lot, a, exempt, taxablePS } = x, price = h.price;
    const F = h.ordered ? 0 : feeFix;                          // feste Gebühr nur beim ersten Verkauf dieser Order
    const fT = taxablePS > 0 ? F * (1 - tfsOf(lot)) : 0;       // die feste Gebühr mindert auch den steuerpflichtigen Gewinn
    // Netto(n) = n·a − F − Steuer; steuerfrei solange n·t − fT ≤ freier Betrag
    const nFree = taxablePS > 0 ? (allowLeft + fT) / taxablePS : Infinity;
    const want = (needed + F) <= nFree * a ? (needed + F) / a : (needed + F - rate * (fT + allowLeft)) / (a - taxablePS * rate);
    const n = Math.min(h.left, ceil8(want));
    const fee = round2(F + n * price * feePct);
    const taxableAmt = exempt ? 0 : Math.max(0, n * taxablePS - fT), free = Math.min(allowLeft, taxableAmt);
    const tax = round2((taxableAmt - free) * rate);
    return { lot, exempt, price, F, n, fee, taxableAmt, free, tax, net: round2(n * price - fee - tax) };
  };
  const rows = [];
  let needed = target;
  while (needed > 0.005) {
    // Steuer je Euro netto, plus die noch offene Fixgebühr umgelegt auf das Netto dieses Schritts (sonst splittet der Plan auf viele Orders)
    let best = null, bs = null, bScore = 0;
    for (const h of heads) {
      if (h.i >= h.lots.length) continue;
      const x = info(h), st = step(h, x), score = x.ratio + (feeAware && st.F > 0 ? st.F / Math.max(st.net, 0.01) : 0);
      if (!best || score < bScore || (score === bScore && st.lot.buyDate < bs.lot.buyDate)) { best = h; bs = st; bScore = score; }
    }
    if (!best) break;
    const { lot, exempt, price, n, fee, taxableAmt, free, tax, net } = bs;
    rows.push({
      lot, shares: n, price, gross: round2(n * price), fee, gain: round2(n * (price - lot.cost - lot.vpCum / lot.shares) - fee),
      taxable: round2(taxableAmt), allowance: round2(free), tax, net, exempt,
    });
    best.ordered = true;
    allowLeft -= free; needed -= net;
    best.left = round8(best.left - n);
    if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
  }
  const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
  return { gross: sum('gross'), fees: sum('fee'), tax: sum('tax'), net: sum('net'), allowanceUsed: sum('allowance'), reached: needed <= 0.005, rows };
}
