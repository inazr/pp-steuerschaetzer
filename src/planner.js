// „Ich brauche X € netto“: verkauft FIFO je Depot × Wertpapier, wählt dabei immer den Lot mit der geringsten
// Steuer je Euro netto. Freibetrag wird in Verkaufsreihenfolge verbraucht, Verluste werden nicht verrechnet.
function planNetSale(result, data, settings, year, target) {
  const total = param('sparerpauschbetrag', year)[settings.veranlagung];
  const used = settings.genutzt ?? prefillUsed(result, settings, year);
  let allowLeft = Math.max(0, total - used);
  const rate = taxRate(settings, year);
  const heads = fifoQueues(result.lots).map(lots => ({ lots, i: 0, left: lots[0].shares, price: (result.latest.get(lots[0].security) || [])[1] }))
    .filter(h => h.price > 0);
  const info = h => {
    const lot = h.lots[h.i], g = taxableGainPerShare(lot, h.price, settings, data);
    const taxablePS = g === null ? 0 : Math.max(0, g);
    return { lot, exempt: g === null, taxablePS, ratio: taxablePS * rate / (h.price - taxablePS * rate) };
  };
  const rows = [];
  let needed = target;
  while (needed > 0.005) {
    let best = null, bi = null;
    for (const h of heads) {
      if (h.i >= h.lots.length) continue;
      const x = info(h);
      if (!best || x.ratio < bi.ratio || (x.ratio === bi.ratio && x.lot.buyDate < bi.lot.buyDate)) { best = h; bi = x; }
    }
    if (!best) break;
    const { lot, exempt, taxablePS } = bi, price = best.price;
    const n1 = taxablePS > 0 ? allowLeft / taxablePS : Infinity; // steuerfrei über den Freibetrag
    const want = needed <= n1 * price ? needed / price : n1 + (needed - n1 * price) / (price - taxablePS * rate);
    const n = Math.min(best.left, ceil8(want));
    const taxableAmt = n * taxablePS, free = Math.min(allowLeft, taxableAmt);
    const tax = round2((taxableAmt - free) * rate);
    const net = round2(n * price - tax);
    rows.push({
      lot, shares: n, price, gross: round2(n * price), gain: round2(n * (price - lot.cost - lot.vpCum / lot.shares)),
      taxable: round2(taxableAmt), allowance: round2(free), tax, net, exempt,
    });
    allowLeft -= free; needed -= net;
    best.left = round8(best.left - n);
    if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
  }
  const sum = k => round2(rows.reduce((s, r) => s + r[k], 0));
  return { gross: sum('gross'), tax: sum('tax'), net: sum('net'), allowanceUsed: sum('allowance'), reached: needed <= 0.005, rows };
}
