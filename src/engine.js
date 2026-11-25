// Steuer-Engine: spielt alle Depotbuchungen chronologisch ab (FIFO je Depot × Wertpapier),
// verbucht zu jedem Jahresende die Vorabpauschale auf die offenen Lots und protokolliert realisierte Gewinne.
const round2 = x => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
const round8 = x => Math.sign(x) * Math.round(Math.abs(x) * 1e8 + 1e-6) / 1e8;
const ceil8 = x => Math.ceil(x * 1e8 - 1e-6) / 1e8;
const isoToDe = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const EPS = 1e-8;

function fundTypeOf(settings, sec) {
  const key = settings.fundTypes && settings.fundTypes[sec.isin || sec.uuid];
  return FUND_TYPES[key] ? key : 'aktienfonds';
}

// Letzter Kurs am oder vor date, höchstens maxDays Tage alt
function priceOnOrBefore(list, date, maxDays = 10) {
  let lo = 0, hi = list.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= date) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx < 0) return null;
  const days = (Date.parse(date) - Date.parse(list[idx][0])) / 864e5;
  return days <= maxDays ? list[idx][1] : null;
}

// § 18 InvStG für einen Lot und ein Jahr
function vpForLot({ wertAnfang, wertEnde, basiszins, ausschuettungen, kaufdatum, jahr }) {
  const basisertrag = basiszins > 0 ? round2(wertAnfang * basiszins * param('vpFaktor', jahr)) : 0;
  const wertsteigerung = wertEnde - wertAnfang;
  // Basisertrag höchstens Wertsteigerung + Ausschüttungen; davon gehen die Ausschüttungen ab
  let vp = basisertrag > 0 ? Math.max(0, Math.min(basisertrag, wertsteigerung + ausschuettungen) - ausschuettungen) : 0;
  if (+kaufdatum.slice(0, 4) === jahr) vp = vp * (13 - +kaufdatum.slice(5, 7)) / 12;
  return { basisertrag, wertsteigerung, vp: round2(vp) };
}

const TX_RANK = { DIV: 0, BUY: 1, DELIVERY_INBOUND: 1, TRANSFER_OUT: 2, TRANSFER_IN: 2, SELL: 3, DELIVERY_OUTBOUND: 3 };

function replay(data, settings, today) {
  const currentYear = +today.slice(0, 4);
  const secById = new Map(data.securities.map(s => [s.uuid, s]));
  const depName = u => (data.portfolios.find(p => p.uuid === u) || {}).name || u;
  const queues = new Map();
  const q = (d, s) => { const k = d + '|' + s; let a = queues.get(k); if (!a) queues.set(k, a = []); return a; };
  const errors = [], warnings = [], vpRows = [], realized = {}, realizedAll = {};
  let lotId = 0;

  const events = [...data.txs, ...data.dividends.map(d => ({ ...d, type: 'DIV' }))]
    .filter(e => e.date <= today)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : (TX_RANK[a.e.type] - TX_RANK[b.e.type]) || a.i - b.i)
    .map(x => x.e);
  const pairs = new Map();
  for (const t of data.txs) if (t.transferKey) {
    const p = pairs.get(t.transferKey) || {};
    p[t.type === 'TRANSFER_OUT' ? 'out' : 'in'] = t;
    pairs.set(t.transferKey, p);
  }

  const insert = (queue, lot) => { let i = queue.length; while (i > 0 && queue[i - 1].buyDate > lot.buyDate) i--; queue.splice(i, 0, lot); };
  // Entnimmt FIFO; teilt den letzten Lot anteilig (inkl. VP)
  const take = (queue, shares) => {
    const pieces = []; let left = shares;
    while (left > EPS && queue.length) {
      const lot = queue[0];
      if (lot.shares <= left + EPS) { pieces.push(queue.shift()); left = round8(left - lot.shares); }
      else {
        const f = left / lot.shares;
        const piece = { ...lot, id: ++lotId, shares: left, vpCum: lot.vpCum * f, divPS: { ...lot.divPS } };
        lot.vpCum -= piece.vpCum; lot.shares = round8(lot.shares - left);
        pieces.push(piece); left = 0;
      }
    }
    return { pieces, missing: left > EPS ? left : 0 };
  };
  const oversold = (ev, missing) => errors.push(`Buchung über Bestand am ${isoToDe(ev.date)}: ${(secById.get(ev.security) || {}).name || ev.security} in ${depName(ev.depot)} (${round8(missing)} Stück fehlen)`);
  const buy = ev => { if (ev.shares > EPS) insert(q(ev.depot, ev.security), { id: ++lotId, depot: ev.depot, security: ev.security, buyDate: ev.date, shares: ev.shares, cost: ev.amount / ev.shares, vpCum: 0, divPS: {} }); };

  const handle = ev => {
    const y = +ev.date.slice(0, 4);
    switch (ev.type) {
      case 'DIV': {
        // Ausschüttung am Konto: auf alle Depots dieses Kontos nach Bestand am Zahltag verteilen
        const queues = (ev.depots || [ev.depot]).map(d => q(d, ev.security));
        const held = queues.reduce((s, qu) => s + qu.reduce((a, l) => a + l.shares, 0), 0);
        if (held > EPS) for (const qu of queues) for (const lot of qu) lot.divPS[y] = (lot.divPS[y] || 0) + ev.gross / held;
        return;
      }
      case 'BUY': case 'DELIVERY_INBOUND': return buy(ev);
      case 'SELL': {
        const { pieces, missing } = take(q(ev.depot, ev.security), ev.shares);
        if (missing) oversold(ev, missing);
        const sec = secById.get(ev.security), ft = FUND_TYPES[fundTypeOf(settings, sec)];
        const pps = (ev.amount + (ev.taxes || 0)) / ev.shares; // PP-Betrag ist nach einbehaltener Steuer
        for (const p of pieces) {
          if (ft.bestandsschutz && p.buyDate < ft.bestandsschutz) continue;
          const gain = ((pps - p.cost) * p.shares - p.vpCum) * (1 - ft.tfs);
          realizedAll[y] = (realizedAll[y] || 0) + gain;
          if (!settings.depots || settings.depots.includes(ev.depot)) realized[y] = (realized[y] || 0) + gain;
        }
        return;
      }
      case 'DELIVERY_OUTBOUND': { const { missing } = take(q(ev.depot, ev.security), ev.shares); if (missing) oversold(ev, missing); return; }
      case 'TRANSFER_OUT': case 'TRANSFER_IN': {
        const p = pairs.get(ev.transferKey);
        if (!p || !p.out || !p.in) {
          if (ev.type === 'TRANSFER_IN') return buy(ev);
          const { missing } = take(q(ev.depot, ev.security), ev.shares); if (missing) oversold(ev, missing); return;
        }
        if (p.done) return;
        p.done = true;
        const { pieces, missing } = take(q(p.out.depot, p.out.security), p.out.shares);
        if (missing) oversold(p.out, missing);
        const target = q(p.in.depot, p.in.security);
        for (const piece of pieces) { piece.depot = p.in.depot; insert(target, piece); }
        return;
      }
    }
  };

  const yearEnd = Y => {
    const open = [...queues.entries()].filter(([, l]) => l.length);
    if (!hasParam('basiszins', Y)) {
      if (Y >= 2018 && open.length) warnings.push(`Kein Basiszins für ${Y} hinterlegt – Vorabpauschale ${Y} nicht berechnet`);
      return;
    }
    const bz = param('basiszins', Y);
    if (bz <= 0) return;
    const rate = taxRate(settings, Y);
    for (const [key, lots] of open) {
      const [depot, security] = key.split('|');
      const sec = secById.get(security), ft = FUND_TYPES[fundTypeOf(settings, sec)];
      if (!ft.vp) continue;
      const list = data.prices.get(security) || [];
      const ps = priceOnOrBefore(list, `${Y}-01-01`), pe = priceOnOrBefore(list, `${Y}-12-31`);
      if (ps === null || pe === null) {
        warnings.push(`Kein Kurs zum ${ps === null ? '01.01.' : '31.12.'}${Y} für ${sec.name} – Vorabpauschale ${Y} übersprungen`);
        continue;
      }
      const row = { year: Y, depot, security, wertAnfang: 0, wertEnde: 0, basiszins: bz, basisertrag: 0, wertsteigerung: 0, ausschuettungen: 0, vp: 0, tfs: ft.tfs };
      for (const lot of lots) {
        const aus = (lot.divPS[Y] || 0) * lot.shares;
        const r = vpForLot({ wertAnfang: lot.shares * ps, wertEnde: lot.shares * pe, basiszins: bz, ausschuettungen: aus, kaufdatum: lot.buyDate, jahr: Y });
        lot.vpCum += r.vp;
        row.wertAnfang += lot.shares * ps; row.wertEnde += lot.shares * pe; row.basisertrag += r.basisertrag;
        row.wertsteigerung += r.wertsteigerung; row.ausschuettungen += aus; row.vp += r.vp;
      }
      for (const k of ['wertAnfang', 'wertEnde', 'basisertrag', 'wertsteigerung', 'ausschuettungen', 'vp']) row[k] = round2(row[k]);
      row.taxable = round2(row.vp * (1 - ft.tfs));
      row.tax = round2(row.taxable * rate);
      vpRows.push(row);
    }
  };

  let doneYear = (events.length ? +events[0].date.slice(0, 4) : currentYear) - 1;
  const flush = upto => { while (doneYear < upto) yearEnd(++doneYear); };
  for (const ev of events) { flush(+ev.date.slice(0, 4) - 1); handle(ev); }
  flush(currentYear - 1);

  const inView = d => !settings.depots || settings.depots.includes(d);
  const latest = new Map();
  for (const [sec, list] of data.prices) if (list.length) latest.set(sec, list[list.length - 1]);
  for (const y in realized) realized[y] = round2(realized[y]);
  for (const y in realizedAll) realizedAll[y] = round2(realizedAll[y]);
  // Freibetrag gilt je Person: Summen über alle Depots, unabhängig vom Anzeigefilter
  const vpTaxableByYear = {};
  for (const r of vpRows) vpTaxableByYear[r.year] = round2((vpTaxableByYear[r.year] || 0) + r.taxable);
  return {
    vpTaxableByYear, realizedAll,
    lots: [...queues.values()].flat().filter(l => inView(l.depot)),
    vpRows: vpRows.filter(r => inView(r.depot)),
    errors, warnings: [...new Set(warnings)], latest, realized,
  };
}
