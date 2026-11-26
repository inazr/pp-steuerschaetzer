// „Ich brauche X € netto“: verkauft FIFO je Depot × Wertpapier, wählt dabei immer den Lot mit der geringsten
// Steuer je Euro netto. Steuer wie die Bank im Jahressaldo (Spec §6): je Bank netYear über die Ereignisse des laufenden
// Jahres plus die Planzeilen, dann taxOf über alle Banken; Steuer eines Schritts = Steuer(mit ihm) − Steuer(ohne ihn).
// Verluste geben so Topf/FSA frei oder erstatten Steuer (Zeilensteuer darf negativ sein).
// Altbestand (Spec §4a, §5): Fonds-Lots vor 2009 zählen für die Auswahl als frei, soweit der 100.000-€-Freibetrag den
// Gewinn des Schritts deckt; Steuer und Netto bleiben die Sicht der Bank. Die erwartete Erstattung über die
// Steuererklärung (100k, BFH) steht getrennt in refund100k/refundBfh und rows[].refund – nie im Netto.
// Zwei Durchläufe: mit Bewertung der Fixgebühr (weniger Orders) und ohne (wie bis 0.2). Behalten wird der Plan mit
// den geringeren Kosten (Gebühren + endgültige Steuer = Bank-Steuer − erwartete Erstattung); so wird die Gebührenbewertung
// nie teurer als die reine Steuer-Reihenfolge.
function planNetSale(result, data, settings, year, target) {
  const a = runNetSale(result, data, settings, year, target, true), b = runNetSale(result, data, settings, year, target, false);
  if (a.reached !== b.reached) return a.reached ? a : b;
  const cost = p => p.fees + p.tax - p.refund100k - p.refundBfh;
  return cost(b) < cost(a) - 0.005 ? b : a;
}

const EXACT = x => x; // ungerundet rechnen (Suche auf 1e-8 Stück)
// Ereignisse je Art zusammenfassen (Gewinne und Verluste aus 'sonst' getrennt) – gleiches netYear, weniger Arbeit
const compactEvents = evs => {
  const s = {};
  for (const e of evs) { const k = e.kind === 'sonst' && e.amount < 0 ? 'sonst-' : e.kind; s[k] = (s[k] || 0) + e.amount; }
  return Object.entries(s).map(([k, amount]) => ({ kind: k === 'sonst-' ? 'sonst' : k, amount }));
};

function runNetSale(result, data, settings, year, target, feeAware) {
  const led = ledger(result, data, settings, year), rate = led.rate;
  // FSA-Regeln wie im Ledger, aus der heutigen Aktivität der Banken. Eine Bank, die erst durch den Plan aktiv würde,
  // ändert die Automatik (eine Bank / gemeinsam) hier bewusst nicht – der Plan rechnet mit dem angezeigten FSA.
  const fsa = led.fsa;
  const bankOf = new Map(led.banks.flatMap(b => b.depots.map(d => [d, b])));
  const baseEvs = new Map(led.banks.map(b => [b.key, compactEvents(b.eventsYear)]));
  const basePos = new Map(led.banks.map(b => [b.key, netYear(b.potsStart, baseEvs.get(b.key), EXACT).positive]));
  const planned = new Map(led.banks.map(b => [b.key, []]));           // Plan-Events je Bank
  // Plan-Events je Bank laufend zusammengefasst (Aktien netto, 'sonst' Gewinne, 'sonst' Verluste): netYear sieht so je
  // Schritt drei zusammengefasste Plan-Events statt des ganzen Plans – gleiches Ergebnis, Laufzeit linear in der Planlänge
  const sums = new Map(led.banks.map(b => [b.key, { aktie: 0, gewinn: 0, verlust: 0 }]));
  const addPlanned = (key, e) => {
    planned.get(key).push(e);
    sums.get(key)[e.kind === 'aktie' ? 'aktie' : e.amount < 0 ? 'verlust' : 'gewinn'] += e.amount;
  };
  const plannedCompact = key => {
    const s = sums.get(key);
    return [{ kind: 'aktie', amount: s.aktie }, { kind: 'sonst', amount: s.gewinn }, { kind: 'sonst', amount: s.verlust }];
  };
  // positiveEff mit Plan-Events: ein „genutzt“-Override bleibt Sockel, der Plan verschiebt ihn um seine Wirkung
  const posEff = (b, e) => b.positiveEff + netYear(b.potsStart, baseEvs.get(b.key).concat(plannedCompact(b.key), [e]), EXACT).positive - basePos.get(b.key);
  let pos = Object.fromEntries(led.banks.map(b => [b.key, b.positiveEff]));
  const init = taxOf(pos, fsa, rate, EXACT);
  let cur = init;
  const usedSum = t => Object.values(t.usedByBank).reduce((s, u) => s + u, 0);
  // 100.000-€-Freibetrag (Spec §3): altLeft = Rest für die Auswahl, sinkt um den 100k-Posten jeder Planzeile.
  // Erwartete Erstattung des Jahres = altRefunds wie altFreibetrag, mit den Planposten nach den Posten des Jahres (heute
  // verkauft) und cap = besteuerte Bemessungsgrundlage mit Plan (taxOf(...).taxable); die Planerstattung ist die Differenz
  // zum Jahr ohne Plan, je Zeile die Differenz zur Vorzeile (Zeile ≥ 0).
  const af = altFreibetrag(result, data, settings, year, led);
  let altLeft = af.left, planBfh = 0;
  const planAlt = [];
  const refundsAt = (cap, alt100k, bfh) => altRefunds(rate, cap, af.leftStart, af.yearAlt100k.concat(alt100k), af.yearBfh + bfh);
  const refund0 = refundsAt(init.taxable, [], 0);
  let refundCur = refund0;

  // Ordergebühren: fester Betrag je Order (= erster Verkauf je Depot × Wertpapier) plus Prozent vom Erlös
  const feeFix = Math.max(0, +settings.gebuehrFix || 0), feePct = Math.max(0, +settings.gebuehrProz || 0) / 100;
  const heads = fifoQueues(result.lots || []).map(lots => ({ lots, i: 0, left: lots[0].shares, price: (result.latest.get(lots[0].security) || [])[1], ordered: false }))
    .filter(h => h.price > 0 && bankOf.has(h.lots[0].depot));
  const secOf = lot => data.securities.find(s => s.uuid === lot.security);
  const info = h => {
    const lot = h.lots[h.i], a = h.price * (1 - feePct); // Erlös je Stück nach Prozentgebühr
    const g = taxableGainPerShare(lot, a, settings, data); // stpfl. Gewinn je Stück, bei Verlust negativ
    return { lot, a, exempt: g === null, g };
  };
  // Auswahlquote (Steuer je Euro netto, endgültige Steuer): Verlust-Lots haben Quote 0. Vor-2009-Lots: der Teil des
  // Schritt-Gewinns (raw), den der Rest des 100k-Freibetrags deckt, zählt als frei – ganz gedeckt Quote 0, ohne Rest normal
  const ratioOf = (x, st) => {
    let taxablePS = x.exempt ? 0 : Math.max(0, x.g);
    if (st.altRaw > 0 && altLeft >= 0.01) taxablePS *= 1 - Math.min(1, altLeft / st.altRaw);
    return taxablePS * rate / (x.a - taxablePS * rate);
  };
  // Ein Verkaufsschritt dieses Kopfes für den aktuellen Restbedarf
  const step = (h, x) => {
    const { lot, a, exempt, g } = x, price = h.price, b = bankOf.get(lot.depot);
    const F = h.ordered ? 0 : feeFix;                          // feste Gebühr nur beim ersten Verkauf dieser Order
    const ft = fundTypeOf(settings, secOf(lot)), tfs = FUND_TYPES[ft].tfs, gp = gainParts(lot, a, FUND_TYPES[ft]);
    // Plan-Event wie der Verkauf (Spec §2): n·taxable − F·(1 − tfs) mit taxable = raw·(1 − tfs) + Altgewinn (2009–2017)
    // aus gainParts, also (n·raw − F)·(1 − tfs) + n·alt; Bestandsschutz-Lots: kein Event
    const ev = n => ({ year, date: '', owner: lot.depot, kind: ft === 'einzelaktie' ? 'aktie' : 'sonst', amount: n * g - F * (1 - tfs) });
    const after = n => {
      if (exempt) return { pos, t: cur, ev: null };
      const e = ev(n), p = { ...pos, [b.key]: posEff(b, e) };
      return { pos: p, t: taxOf(p, fsa, rate, EXACT), ev: e };
    };
    // Netto ungerundet und so, wie die Zeile es bucht (Gebühr und Steuer auf Cent): beide müssen den Restbedarf decken,
    // sonst fehlt der Zeile 1 ct und eine Staubzeile (~0,0001 Stück für 0,01 €) folgt
    const ok = k => {
      const n = k / 1e8, dt = after(n).t.tax - cur.tax;
      return n * a - F - dt >= needed - 1e-9 && round2(n * price - round2(F + n * price * feePct) - round2(dt)) >= needed - 1e-9;
    };
    // Kleinste Stückzahl auf dem 1e-8-Raster mit Netto ≥ Restbedarf (Netto steigt monoton in n); sonst alles
    const K = Math.round(h.left * 1e8);
    let hi = K;
    if (ok(K)) { let lo = 0; while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (ok(m)) hi = m; else lo = m; } }
    const n = hi === K ? h.left : hi / 1e8, st = after(n);
    const fee = round2(F + n * price * feePct), tax = round2(st.t.tax - cur.tax);
    // Veranlagungs-Posten der Zeile wie im Verkauf (Spec §2), Gewinn nach Gebühren: vor 2009 alt100k = raw (> 0);
    // 2009–2017 bei raw < 0 BFH-Differenz F·tfs mit Fiktions-Anteil F = min(Kursverlust unter Kurs 31.12.2017, Altgewinn)
    const raw = n * gp.raw - F, priceRaw = n * gp.priceRaw - F;
    const altRaw = gp.pre2009 && raw > 0 ? raw : 0;
    const bfh = lot.alt && !gp.pre2009 && raw < 0 && gp.alt > 0 ? Math.min(Math.max(0, -priceRaw), n * gp.alt) * tfs : 0;
    return { lot, bank: b.key, exempt, price, F, n, fee, st, tax, net: round2(n * price - fee - tax), tfs, altRaw, bfh,
      gain: round2(n * (gainParts(lot, price, FUND_TYPES[ft]).raw + gp.alt) - fee) };
  };
  const rows = [];
  let needed = target;
  while (needed > 0.005) {
    // Steuer je Euro netto, plus die noch offene Fixgebühr umgelegt auf das Netto dieses Schritts (sonst splittet der Plan auf viele Orders)
    let best = null, bs = null, bScore = 0;
    for (const h of heads) {
      if (h.i >= h.lots.length) continue;
      const x = info(h), st = step(h, x), score = ratioOf(x, st) + (feeAware && st.F > 0 ? st.F / Math.max(st.net, 0.01) : 0);
      if (!best || score < bScore || (score === bScore && st.lot.buyDate < bs.lot.buyDate)) { best = h; bs = st; bScore = score; }
    }
    if (!best) break;
    const { lot, bank, exempt, price, n, fee, st, tax, net, tfs, altRaw, bfh, gain } = bs;
    if (altRaw > 0) { planAlt.push({ amount: altRaw, tfs }); altLeft = Math.max(0, altLeft - altRaw); }
    planBfh += bfh;
    const refundNext = refundsAt(st.t.taxable, planAlt, planBfh);
    const refund = round2(Math.max(0, refundNext.refund100k + refundNext.refundBfh - refundCur.refund100k - refundCur.refundBfh));
    refundCur = refundNext;
    rows.push({
      // Gewinn vor Teilfreistellung nach Gebühren: Neugewinn + Altgewinn (gainParts; ohne Altbestand wie 0.4)
      bank, lot, shares: n, price, gross: round2(n * price), fee, gain,
      // Änderung der Bemessungsgrundlage bzw. des genutzten FSA durch diese Zeile (nach Töpfen; kann negativ sein)
      taxable: round2(st.t.taxable - cur.taxable), allowance: round2(usedSum(st.t) - usedSum(cur)), tax, net, exempt, refund,
    });
    if (st.ev) addPlanned(bank, st.ev);
    pos = st.pos; cur = st.t;
    best.ordered = true;
    needed -= net;
    best.left = round8(best.left - n);
    if (best.left <= EPS) { best.i++; best.left = best.i < best.lots.length ? best.lots[best.i].shares : 0; }
  }
  const sum = (rs, k) => round2(rs.reduce((s, r) => s + r[k], 0));
  // Je Bank: fsaUsed = genutzter FSA mit Plan − ohne Plan (im gemeinsamen Modus kann sich Nutzung zwischen Banken
  // verschieben); potsUsed = Topfstand Jahresende ohne Plan − mit Plan (negativ: der Plan füllt den Topf)
  const banks = led.banks.map(b => {
    const rs = rows.filter(r => r.bank === b.key), evs = planned.get(b.key);
    const potsWith = netYear(b.potsStart, b.eventsYear.concat(evs)).potsAfter;
    return { key: b.key, label: b.label, fees: sum(rs, 'fee'), tax: sum(rs, 'tax'),
      fsaUsed: round2((cur.usedByBank[b.key] || 0) - (init.usedByBank[b.key] || 0)),
      potsUsed: { aktien: round2(b.pots.aktien - potsWith.aktien), allg: round2(b.pots.allg - potsWith.allg) }, rows: rs.length };
  }).filter(b => b.rows || b.fsaUsed).map(({ rows: _, ...b }) => b);
  return { gross: sum(rows, 'gross'), fees: sum(rows, 'fee'), tax: sum(rows, 'tax'), net: sum(rows, 'net'),
    allowanceUsed: round2(banks.reduce((s, b) => s + b.fsaUsed, 0)), reached: needed <= 0.005, rows, banks,
    refund100k: round2(Math.max(0, refundCur.refund100k - refund0.refund100k)),
    refundBfh: round2(Math.max(0, refundCur.refundBfh - refund0.refundBfh)) };
}
