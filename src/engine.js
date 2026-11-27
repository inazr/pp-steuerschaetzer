// Steuer-Engine: spielt alle Depotbuchungen chronologisch ab (FIFO je Depot × Wertpapier),
// verbucht zu jedem Jahresende die Vorabpauschale auf die offenen Lots und protokolliert realisierte Gewinne.
const round2 = x => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
const round8 = x => Math.sign(x) * Math.round(Math.abs(x) * 1e8 + 1e-6) / 1e8;
const isoToDe = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const EPS = 1e-8;
// Zufluss der Vorabpauschale: erster Werktag des Jahres (02.01., am Wochenende der folgende Montag; § 18 Abs. 3 InvStG)
function vpInflowDate(year) {
  const dow = new Date(Date.UTC(year, 0, 2)).getUTCDay();
  return `${year}-01-0${dow === 6 ? 4 : dow === 0 ? 3 : 2}`;
}
// Ex-Tag bis Zahltag liegt bei ETFs meist 1–4 Wochen: so lange gilt ein geleertes Depot noch als Empfänger einer Ausschüttung
const DIV_ORPHAN_DAYS = 60;

// Explizite Wahl des Nutzers (je ISIN, sonst UUID), sonst geraten
const explicitFundType = (settings, sec) => { const key = settings.fundTypes && sec && settings.fundTypes[sec.isin || sec.uuid]; return FUND_TYPES[key] ? key : null; };
const fundTypeOf = (settings, sec) => explicitFundType(settings, sec) || guessFundType(sec);
const fundTypeGuessed = (settings, sec) => !explicitFundType(settings, sec);
// Ereignisart eines Verkaufs: 'aktie' (Aktientopf) oder 'sonst' (allgemeiner Topf)
const potKind = (settings, sec) => FUND_TYPES[fundTypeOf(settings, sec)].pot;
const secByUuid = (data, uuid) => data.securities.find(s => s.uuid === uuid);

// Gewinn je Stück bei Verkauf zu price: neues Recht (raw, mit TFS) und Altgewinn bis 31.12.2017 (§ 56 InvStG)
function gainParts(lot, price, ft) {
  const raw = price - lot.cost - lot.vpCum / lot.shares;
  const alt = lot.alt ? lot.alt.gainPS : 0, pre2009 = !!(lot.alt && lot.alt.pre2009);
  const altTaxable = lot.alt && !pre2009 ? alt : 0;
  return { raw, priceRaw: lot.alt ? price - lot.alt.price : raw, alt, altTaxable, taxable: raw * (1 - ft.tfs) + altTaxable, pre2009 };
}

// Letzter Kurs am oder vor date, höchstens maxDays Tage alt
function priceOnOrBefore(list, date, maxDays = 10) {
  let lo = 0, hi = list.length - 1, idx = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m][0] <= date) { idx = m; lo = m + 1; } else hi = m - 1; }
  if (idx < 0) return null;
  const days = (Date.parse(date) - Date.parse(list[idx][0])) / 864e5;
  return days <= maxDays ? list[idx][1] : null;
}

// Kurs zu Beginn des Jahres: letzter Kurs am oder vor dem 01.01.; fehlt der (Kurshistorie beginnt im Januar), der erste Kurs bis 10.01.
function priceAtYearStart(list, year) {
  const before = priceOnOrBefore(list, `${year}-01-01`);
  if (before !== null) return before;
  const first = list.find(p => p[0] >= `${year}-01-01`);
  return first && first[0] <= `${year}-01-10` ? first[1] : null;
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
  const errors = [], warnings = [], vpRows = [], realized = {}, distributions = {}, income = [], veranlagung = [];
  const addIncome = (date, owner, kind, amount) => income.push({ year: +date.slice(0, 4), date, owner, kind, amount: round2(amount) });
  let lotId = 0;
  const inView = d => !settings.depots || settings.depots.includes(d);
  const lastHeld = new Map(); // depot|security -> { date, shares } unmittelbar bevor die Queue leer wurde

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
        const piece = { ...lot, id: ++lotId, shares: left, vpCum: lot.vpCum * f, divPS: { ...lot.divPS }, alt: lot.alt && { ...lot.alt } };
        lot.vpCum -= piece.vpCum; lot.shares = round8(lot.shares - left);
        pieces.push(piece); left = 0;
      }
    }
    return { pieces, missing: left > EPS ? left : 0 };
  };
  // FIFO-Abgang einer Buchung; merkt sich den Bestand, falls die Queue dadurch leer wird
  const takeFrom = t => {
    const queue = q(t.depot, t.security), before = queue.reduce((s, l) => s + l.shares, 0);
    const r = take(queue, t.shares);
    if (!queue.length && before > EPS) lastHeld.set(t.depot + '|' + t.security, { date: t.date, shares: before });
    return r;
  };
  const oversold = (ev, missing) => errors.push(`Buchung über Bestand am ${isoToDe(ev.date)}: ${(secById.get(ev.security) || {}).name || ev.security} in ${depName(ev.depot)} (${round8(missing)} Stück fehlen)`);
  // Ausschüttung je Stück, die ein Depot (bzw. sein Konto) im Jahr schon gesehen hat: depot|security|Jahr. § 18 Abs. 1 InvStG zählt die
  // Ausschüttungen des Fonds im Kalenderjahr je Anteil – ein später gekaufter Lot erbt sie deshalb für sein Kaufjahr.
  const divSeen = new Map();
  const buy = ev => {
    if (!(ev.shares > EPS)) return;
    const y = +ev.date.slice(0, 4), seen = divSeen.get(`${ev.depot}|${ev.security}|${y}`);
    insert(q(ev.depot, ev.security), { id: ++lotId, depot: ev.depot, security: ev.security, buyDate: ev.date, shares: ev.shares, cost: ev.amount / ev.shares, vpCum: 0, divPS: seen > 0 ? { [y]: seen } : {} });
  };

  const handle = ev => {
    const y = +ev.date.slice(0, 4);
    switch (ev.type) {
      case 'DIV': {
        // Ausschüttung am Konto: auf alle Depots dieses Kontos nach Bestand am Zahltag verteilen
        const queues = (ev.depots || [ev.depot]).map(d => q(d, ev.security));
        const held = queues.reduce((s, qu) => s + qu.reduce((a, l) => a + l.shares, 0), 0);
        const ft = FUND_TYPES[fundTypeOf(settings, secById.get(ev.security))];
        const perDepot = new Map();
        if (held > EPS) {
          for (const d of ev.depots || [ev.depot]) { const k = `${d}|${ev.security}|${y}`; divSeen.set(k, (divSeen.get(k) || 0) + ev.gross / held); }
          for (const qu of queues) for (const lot of qu) {
            lot.divPS[y] = (lot.divPS[y] || 0) + ev.gross / held;
            const a = ev.gross / held * lot.shares * (1 - ft.tfs);
            perDepot.set(lot.depot, (perDepot.get(lot.depot) || 0) + a);
            // steuerpflichtiger Teil verbraucht den Freibetrag (nur ausgewählte Depots)
            if (inView(lot.depot)) distributions[y] = (distributions[y] || 0) + a;
          }
          for (const [d, a] of perDepot) addIncome(ev.date, d, 'div', a);
        }
        else {
          // Kein Bestand am Zahltag (Verkauf zwischen Ex-Tag und Zahltag): Depots mit dem letzten Bestand, sonst ignorieren
          const since = Date.parse(ev.date) - DIV_ORPHAN_DAYS * 864e5;
          const last = (ev.depots || [ev.depot]).map(d => [d, lastHeld.get(d + '|' + ev.security)]).filter(([, h]) => h && Date.parse(h.date) >= since);
          const name = (secById.get(ev.security) || {}).name || ev.security;
          const total = last.reduce((s, [, h]) => s + h.shares, 0);
          if (!last.length) { warnings.push(`Ausschüttung vom ${isoToDe(ev.date)} für ${name} ohne Bestand ignoriert`); return; }
          for (const [d, h] of last) {
            const a = ev.gross * h.shares / total * (1 - ft.tfs);
            if (inView(d)) distributions[y] = (distributions[y] || 0) + a;
            addIncome(ev.date, d, 'div', a);
          }
          warnings.push(`Ausschüttung vom ${isoToDe(ev.date)} für ${name} ohne Bestand – dem letzten Bestand in ${last.map(([d]) => depName(d)).join(', ')} zugeordnet`);
        }
        return;
      }
      case 'BUY': case 'DELIVERY_INBOUND': return buy(ev);
      case 'SELL': {
        const { pieces, missing } = takeFrom(ev);
        if (missing) oversold(ev, missing);
        const sec = secById.get(ev.security), ft = FUND_TYPES[fundTypeOf(settings, sec)];
        const pps = (ev.amount + (ev.taxes || 0)) / ev.shares; // PP-Betrag ist nach einbehaltener Steuer
        let total = 0, counted = false;
        for (const p of pieces) {
          if (ft.bestandsschutz && p.buyDate < ft.bestandsschutz) continue;
          const gp = gainParts(p, pps, ft), gain = gp.taxable * p.shares;
          total += gain; counted = true;
          if (!settings.depots || settings.depots.includes(ev.depot)) realized[y] = (realized[y] || 0) + gain;
          if (gp.alt && !gp.pre2009 && gp.raw < 0 && gp.alt > 0) {
            const F = Math.min(Math.max(0, -gp.priceRaw * p.shares), gp.alt * p.shares);
            if (F * ft.tfs > 0) veranlagung.push({ year: y, date: ev.date, depot: ev.depot, kind: 'bfh', amount: round2(F * ft.tfs), tfs: ft.tfs });
          }
          if (gp.pre2009 && gp.raw > 0) veranlagung.push({ year: y, date: ev.date, depot: ev.depot, kind: 'alt100k', amount: round2(gp.raw * (1 - ft.tfs) * p.shares) }); // nach Teilfreistellung (BMF 21.05.2019, Rz. 56.101)
        }
        if (counted) addIncome(ev.date, ev.depot, potKind(settings, sec), total);
        return;
      }
      case 'DELIVERY_OUTBOUND': { const { missing } = takeFrom(ev); if (missing) oversold(ev, missing); return; }
      case 'TRANSFER_OUT': case 'TRANSFER_IN': {
        const p = pairs.get(ev.transferKey);
        if (!p || !p.out || !p.in) {
          if (ev.type === 'TRANSFER_IN') return buy(ev);
          const { missing } = takeFrom(ev); if (missing) oversold(ev, missing); return;
        }
        if (p.done) return;
        p.done = true;
        const { pieces, missing } = takeFrom(p.out);
        lastHeld.delete(p.out.depot + '|' + p.out.security); // Bestand ist nur umgezogen, nicht abgegangen
        if (missing) oversold(p.out, missing);
        const target = q(p.in.depot, p.in.security);
        // Das Zieldepot kennt damit die Ausschüttung je Stück des Jahres (für spätere Käufe dort, s. divSeen)
        const seenKey = `${p.in.depot}|${p.in.security}|${y}`;
        for (const piece of pieces) {
          piece.depot = p.in.depot; insert(target, piece);
          if (piece.divPS[y] > (divSeen.get(seenKey) || 0)) divSeen.set(seenKey, piece.divPS[y]);
        }
        return;
      }
    }
  };

  // Vorabpauschale eines Jahres für alle offenen Lots. endPrice(list) liefert [Kurs, Datum] zum Jahresende
  // (oder den letzten Kurs für die Prognose). commit = Lots fortschreiben; sonst nur rechnen (Prognose).
  const forecastLots = [];
  const vpYear = (Y, endPrice, commit, label) => {
    const out = [];
    const bz = param('basiszins', Y);
    if (bz <= 0) return out;
    const rate = taxRate(settings, Y);
    for (const [key, lots] of [...queues.entries()].filter(([, l]) => l.length)) {
      const [depot, security] = key.split('|');
      const sec = secById.get(security), ft = FUND_TYPES[fundTypeOf(settings, sec)];
      if (!ft.vp) continue;
      const list = data.prices.get(security) || [];
      const ps = priceAtYearStart(list, Y), end = endPrice(list), pe = end && end[0];
      if (ps === null || !pe) {
        warnings.push(`Kein Kurs zum ${ps === null ? '01.01.' : '31.12.'}${Y} für ${sec.name} – ${label} übersprungen`);
        continue;
      }
      const row = { year: Y, depot, security, wertAnfang: 0, wertEnde: 0, basiszins: bz, basisertrag: 0, wertsteigerung: 0, ausschuettungen: 0, vp: 0, tfs: ft.tfs };
      for (const lot of lots) {
        const aus = (lot.divPS[Y] || 0) * lot.shares;
        const r = vpForLot({ wertAnfang: lot.shares * ps, wertEnde: lot.shares * pe, basiszins: bz, ausschuettungen: aus, kaufdatum: lot.buyDate, jahr: Y });
        if (commit) lot.vpCum += r.vp;
        // Prognose je Lot für den Dezember-Effekt: wie oben und ohne Zwölftelung (Kaufdatum vor dem Jahr)
        else forecastLots.push({ lotId: lot.id, depot, security, tfs: ft.tfs, vpPS: r.vp / lot.shares,
          vpFullPS: vpForLot({ wertAnfang: lot.shares * ps, wertEnde: lot.shares * pe, basiszins: bz, ausschuettungen: aus, kaufdatum: `${Y - 1}-12-31`, jahr: Y }).vp / lot.shares });
        row.wertAnfang += lot.shares * ps; row.wertEnde += lot.shares * pe; row.basisertrag += r.basisertrag;
        row.wertsteigerung += r.wertsteigerung; row.ausschuettungen += aus; row.vp += r.vp;
      }
      for (const k of ['wertAnfang', 'wertEnde', 'basisertrag', 'wertsteigerung', 'ausschuettungen', 'vp']) row[k] = round2(row[k]);
      row.taxable = round2(row.vp * (1 - ft.tfs));
      row.tax = round2(row.taxable * rate);
      if (!commit) row.priceDate = end[1];
      out.push(row);
    }
    return out;
  };
  // Bestand, für den eine Vorabpauschale anfällt: nur dann fehlt ein Basiszins wirklich (Einzelaktien, sonstige Wertpapiere brauchen keinen)
  const holdsVpFunds = () => [...queues.entries()].some(([key, lots]) => lots.length && FUND_TYPES[fundTypeOf(settings, secById.get(key.split('|')[1]))].vp);
  const yearEnd = Y => {
    if (!hasParam('basiszins', Y)) {
      if (Y >= 2018 && holdsVpFunds()) warnings.push(`Kein Basiszins für ${Y} hinterlegt – Vorabpauschale ${Y} nicht berechnet`);
      return;
    }
    vpRows.push(...vpYear(Y, list => { const p = priceOnOrBefore(list, `${Y}-12-31`); return p === null ? null : [p, `${Y}-12-31`]; }, true, `Vorabpauschale ${Y}`));
  };

  // § 56 Abs. 2 InvStG: fiktive Veräußerung zum 31.12.2017 für Fondsanteile, die vorher gekauft wurden (genau einmal, vor allem aus 2018)
  let switched = false;
  const switchOver = () => {
    if (switched) return;
    switched = true;
    for (const [key, lots] of queues) {
      const sec = secById.get(key.split('|')[1]);
      if (!lots.length || !FUND_TYPES[fundTypeOf(settings, sec)].vp) continue;
      const old = lots.filter(l => l.buyDate < '2018-01-01');
      if (!old.length) continue;
      const price = priceOnOrBefore(data.prices.get(sec.uuid) || [], '2017-12-31');
      if (price === null) { warnings.push(`Kein Kurs zum 31.12.2017 für ${sec.name} – fiktive Veräußerung nicht berechnet, Gewinn vom ursprünglichen Einstand`); continue; }
      for (const l of old) { l.origCost = l.cost; l.alt = { price, gainPS: price - l.cost, pre2009: l.buyDate < '2009-01-01' }; l.cost = price; }
    }
  };

  let doneYear = (events.length ? +events[0].date.slice(0, 4) : currentYear) - 1;
  const flush = upto => { while (doneYear < upto) yearEnd(++doneYear); };
  for (const ev of events) { if (ev.date >= '2018-01-01') switchOver(); flush(+ev.date.slice(0, 4) - 1); handle(ev); }
  if (today >= '2018-01-01') switchOver();
  flush(currentYear - 1);
  // Prognose für das laufende Jahr (fließt im Januar des Folgejahres zu): letzter Kurs statt Kurs zum 31.12.
  const vpForecast = hasParam('basiszins', currentYear)
    ? vpYear(currentYear, list => list.length ? [list[list.length - 1][1], list[list.length - 1][0]] : null, false, `Prognose Vorabpauschale ${currentYear}`)
    : [];
  if (!hasParam('basiszins', currentYear) && holdsVpFunds()) warnings.push(`Kein Basiszins für ${currentYear} hinterlegt – Prognose der Vorabpauschale nicht berechnet`);

  // VP des Jahres Y fließt am ersten Werktag des Folgejahres zu; Zinsen je Konto
  // (vpRows gibt es nur für abgeschlossene Jahre: der Ertrag zählt ab Jahresbeginn, auch in den Tagen vor dem ersten Werktag)
  for (const r of vpRows) if (r.taxable > 0) addIncome(vpInflowDate(r.year + 1), r.depot, 'vp', r.taxable);
  for (const z of data.interest || []) if (z.date <= today) addIncome(z.date, z.account, 'zins', z.gross);
  income.sort(byDate);
  veranlagung.sort(byDate);

  const latest = new Map();
  for (const [sec, list] of data.prices) if (list.length) latest.set(sec, list[list.length - 1]);
  for (const y in realized) realized[y] = round2(realized[y]);
  for (const y in distributions) distributions[y] = round2(distributions[y]);
  // Freibetrag gilt je Person: Summen nur über die ausgewählten Depots (eine Datei kann Depots mehrerer Personen enthalten)
  const vpTaxableByYear = {};
  for (const r of vpRows) if (inView(r.depot)) vpTaxableByYear[r.year] = round2((vpTaxableByYear[r.year] || 0) + r.taxable);
  return {
    vpTaxableByYear,
    lots: [...queues.values()].flat().filter(l => inView(l.depot)),
    vpRows: vpRows.filter(r => inView(r.depot)),
    vpForecast: vpForecast.filter(r => inView(r.depot)), vpForecastLots: forecastLots.filter(r => inView(r.depot)), distributions,
    errors, warnings: [...new Set(warnings)], latest, realized, income, veranlagung,
  };
}
