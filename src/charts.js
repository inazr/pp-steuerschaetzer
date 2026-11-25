// ECharts-Optionen als reine Funktionen (testbar ohne Browser). tokens kommen aus den CSS-Variablen der Seite.
function chartBase(t) {
  return {
    backgroundColor: 'transparent', animationDuration: 300,
    textStyle: { fontFamily: t.fontUi, color: t.ink2 },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface, borderColor: t.line, textStyle: { color: t.ink, fontFamily: t.fontUi, fontSize: 12 },
      extraCssText: 'box-shadow:0 4px 16px rgb(0 0 0 / .12);border-radius:6px',
    },
  };
}
const chartValueAxis = t => ({
  type: 'value', axisLabel: { color: t.ink3, fontFamily: t.fontNum, formatter: v => fmtEur(v).replace(/,00\s?€/, ' €') },
  splitLine: { lineStyle: { color: t.line, type: 'dashed' } },
});
const chartCatAxis = (t, data) => ({ type: 'category', data, axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, axisLabel: { color: t.ink2 } });
const chartLegend = (t, show) => ({ show, top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.ink2 } });
const htmlEsc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tipHead = v => `<b>${htmlEsc(v)}</b>`;
const tipRow = (color, name, value) => `<div style="display:flex;gap:12px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${color};margin-right:6px"></span>${htmlEsc(name)}</span><b style="font-family:var(--font-num)">${value}</b></div>`;
// Farbe folgt dem Wertpapier (Reihenfolge in der Datei), nie dem Rang
const secColor = (t, data, uuid) => t.series[Math.max(0, data.securities.findIndex(s => s.uuid === uuid)) % t.series.length];

function optVpByYear(vpRows, data, t) {
  const years = [...new Set(vpRows.map(r => r.year))].sort((a, b) => a - b);
  const secs = data.securities.filter(s => vpRows.some(r => r.security === s.uuid));
  const sum = (sec, y, k) => round2(vpRows.filter(r => r.security === sec && r.year === y).reduce((s, r) => s + r[k], 0));
  return {
    ...chartBase(t),
    legend: chartLegend(t, secs.length > 1),
    tooltip: {
      ...chartBase(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: ps => tipHead(ps[0].axisValue) + ps.filter(p => p.value).map(p => tipRow(p.color, p.seriesName, fmtEur(p.value) + ` <span style="font-weight:400;color:${t.ink3}">Steuer ${fmtEur(p.data.tax)}</span>`)).join(''),
    },
    xAxis: chartCatAxis(t, years.map(String)),
    yAxis: chartValueAxis(t),
    series: secs.map(s => ({
      name: s.name, type: 'bar', stack: 'vp', barMaxWidth: 36,
      itemStyle: { color: secColor(t, data, s.uuid), borderColor: t.surface, borderWidth: 1 },
      emphasis: { focus: 'series' },
      data: years.map(y => ({ value: sum(s.uuid, y, 'vp'), tax: sum(s.uuid, y, 'tax') })),
    })),
  };
}

function optAllowance(a, t) {
  const harvest = Math.min(a.harvested, a.remaining);
  const parts = [['Bereits genutzt', a.used, t.ink3], ['Vorschlag', harvest, t.series[0]], ['Noch frei', Math.max(0, a.total - a.used - harvest), t.line]];
  return {
    ...chartBase(t),
    grid: { left: 8, right: 40, top: 36, bottom: 8, containLabel: true },
    legend: chartLegend(t, true),
    tooltip: { ...chartBase(t).tooltip, trigger: 'item', formatter: p => tipRow(p.color, p.seriesName, fmtEur(p.value)) },
    xAxis: { ...chartValueAxis(t), max: a.total },
    yAxis: { type: 'category', data: ['Freibetrag'], show: false },
    series: parts.map(([name, v, color]) => ({ name, type: 'bar', stack: 'fb', barWidth: 28, data: [round2(Math.min(v, a.total))], itemStyle: { color, borderColor: t.surface, borderWidth: 2 } })),
  };
}

// Unrealisierte Gewinne: je Wertpapier ein Diagramm untereinander (gemeinsame Zeitachse = Kaufdatum).
// Jede Säule = Bruttogewinn der Lots eines Kauftags, geteilt in steuerpflichtig (an der Null) und steuerfrei (außen).
const LOT_TOP = 36, LOT_PANEL = 210, LOT_PLOT = 140, DAY = 864e5;
const NF_MON = new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' });
// ISO-Kalenderwoche: Montag als Datum, Wochennummer und Wochenjahr (das Jahr des Donnerstags)
function isoWeek(iso) {
  const d = new Date(iso + 'T00:00:00Z'), dow = (d.getUTCDay() + 6) % 7;
  const mon = new Date(d.getTime() - dow * DAY), thu = new Date(mon.getTime() + 3 * DAY);
  const year = thu.getUTCFullYear(), jan4 = new Date(Date.UTC(year, 0, 4));
  const week1 = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  return { monday: mon.toISOString().slice(0, 10), week: Math.round((mon.getTime() - week1) / (7 * DAY)) + 1, year };
}
const lotChartHeight = opt => LOT_TOP + Math.max(1, opt.grid.length) * LOT_PANEL;

function optLotGains(result, data, settings, t) {
  const showDepot = new Set(result.lots.map(l => l.depot)).size > 1;
  const depName = id => (data.portfolios.find(p => p.uuid === id) || {}).name || '';
  const panels = data.securities.map(sec => {
    const price = (result.latest.get(sec.uuid) || [])[1];
    const byWeek = new Map(); // je Kalenderwoche eine Säule, sonst überdecken sich Käufe weniger Tage Abstand
    for (const l of result.lots) {
      if (l.security !== sec.uuid || !(price > 0)) continue;
      const g = taxableGainPerShare(l, price, settings, data), w = isoWeek(l.buyDate);
      const e = byWeek.get(w.monday) || { date: w.monday, week: w.week, weekYear: w.year, brutto: 0, taxable: 0, depots: new Set(), buys: new Set() };
      e.brutto += (price - l.cost) * l.shares;
      e.taxable += g === null ? 0 : g * l.shares;
      e.depots.add(l.depot);
      e.buys.add(l.buyDate);
      byWeek.set(w.monday, e);
    }
    const cols = [...byWeek.values()].sort((a, b) => a.date < b.date ? -1 : 1).map(e => {
      const brutto = round2(e.brutto), taxable = round2(e.taxable);
      return { ...e, brutto, taxable, free: round2(brutto - taxable) };
    });
    return { sec, cols };
  }).filter(p => p.cols.length);

  const dates = panels.flatMap(p => p.cols.map(c => Date.parse(c.date)));
  const min = Math.min(...dates) - 20 * DAY, max = Math.max(...dates) + 20 * DAY;
  // Abgerundet wird nur das äußere Ende des Segments, das in seiner Richtung zuletzt liegt
  const end = v => v > 0 ? [4, 4, 0, 0] : v < 0 ? [0, 0, 4, 4] : 0;
  // value = [Kaufdatum, Segmenthöhe, Anfang, Ende]; der steuerfreie Teil setzt am steuerpflichtigen an, wenn beide gleiches Vorzeichen haben
  const part = (cols, key, outer, base) => cols.map(c => {
    const b = base(c);
    return { value: [c.date, c[key], b, round2(b + c[key])], itemStyle: { borderRadius: outer(c) ? end(c[key]) : 0 } };
  });
  // Säulen selbst zeichnen: Balken-Serien würden die Zeitachse je Diagramm unterschiedlich verbreitern
  const column = (data, color) => (params, api) => {
    const x = api.coord([api.value(0), 0])[0], y0 = api.coord([api.value(0), api.value(2)])[1], y1 = api.coord([api.value(0), api.value(3)])[1];
    const r = data[params.dataIndex].itemStyle.borderRadius || 0;
    return { type: 'rect', shape: { x: x - 4, y: Math.min(y0, y1), width: 8, height: Math.abs(y1 - y0), r }, style: { fill: color, stroke: t.surface, lineWidth: 1 } };
  };
  const top = i => LOT_TOP + i * LOT_PANEL + 28;
  const TIP = { steuerpflichtig: 'steuerpflichtig', steuerfrei: 'steuerfrei (Teilfreistellung, versteuerte VP)' };

  return {
    ...chartBase(t),
    legend: chartLegend(t, true),
    title: panels.map((p, i) => ({ text: p.sec.name, left: 0, top: top(i) - 26, textStyle: { color: t.ink2, fontFamily: t.fontUi, fontSize: 12, fontWeight: 600 } })),
    // fester linker Rand statt containLabel: sonst verschiebt die Breite der y-Beschriftung die Zeitachse je Diagramm
    grid: panels.map((p, i) => ({ left: 84, right: 24, top: top(i), height: LOT_PLOT, containLabel: false })),
    xAxis: panels.map((p, i) => ({
      type: 'time', gridIndex: i, min, max, minInterval: 28 * DAY,
      axisLine: { lineStyle: { color: t.line } }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { color: t.ink3, fontFamily: t.fontNum, hideOverlap: true, formatter: v => NF_MON.format(new Date(v)) },
    })),
    yAxis: panels.map((p, i) => ({ ...chartValueAxis(t), gridIndex: i, splitNumber: 3 })),
    tooltip: {
      ...chartBase(t).tooltip, trigger: 'item', confine: true,
      formatter: p => {
        const c = panels[Math.floor(p.seriesIndex / 2)].cols[p.dataIndex];
        const head = `${panels[Math.floor(p.seriesIndex / 2)].sec.name} · KW ${c.week}/${c.weekYear}`;
        const buys = `<div>${c.buys.size === 1 ? 'Kauf' : 'Käufe'} ${[...c.buys].sort().map(fmtDate).join(', ')}</div>`;
        const dep = showDepot ? `<div>${htmlEsc([...c.depots].map(depName).join(', '))}</div>` : '';
        return tipHead(head) + buys + dep + tipRow('transparent', 'Gewinn brutto', fmtEur(c.brutto))
          + tipRow(t.series[1], TIP.steuerpflichtig, fmtEur(c.taxable)) + tipRow(t.series[0], TIP.steuerfrei, fmtEur(c.free));
      },
    },
    series: panels.flatMap((p, i) => {
      const seg = (name, color, data) => ({ name, type: 'custom', xAxisIndex: i, yAxisIndex: i, data, encode: { x: 0, y: [2, 3] }, itemStyle: { color }, renderItem: column(data, color) });
      const same = c => Math.sign(c.free) === Math.sign(c.taxable);
      return [
        seg('steuerpflichtig', t.series[1], part(p.cols, 'taxable', c => !c.free || !same(c), () => 0)),
        seg('steuerfrei', t.series[0], part(p.cols, 'free', c => !!c.free, c => same(c) ? c.taxable : 0)),
      ];
    }),
  };
}

function optWaterfall(plan, data, t) {
  const bySec = [];
  for (const r of plan.rows) {
    let e = bySec.find(x => x.uuid === r.lot.security);
    if (!e) bySec.push(e = { uuid: r.lot.security, name: (data.securities.find(s => s.uuid === r.lot.security) || {}).name, gross: 0 });
    e.gross += r.gross;
  }
  const fees = plan.fees || 0;
  const cats = [...bySec.map(e => e.name), ...(fees > 0 ? ['Gebühren'] : []), plan.tax < 0 ? 'Erstattung' : 'Steuer', 'Netto'];
  const base = [], vis = [];
  let acc = 0;
  for (const e of bySec) { base.push(round2(acc)); vis.push({ value: round2(e.gross), itemStyle: { color: secColor(t, data, e.uuid) } }); acc += e.gross; }
  // Gebühren und Steuer hängen von oben herab: Gebühren ab Brutto, Steuer darunter bis Netto
  if (fees > 0) { base.push(round2(acc - fees)); vis.push({ value: round2(fees), itemStyle: { color: t.ink2 } }); }
  // Erstattung (negative Steuer): Balken steigt von Brutto − Gebühren bis Netto
  const refund = plan.tax < 0;
  base.push(round2(refund ? plan.net + plan.tax : plan.net)); vis.push({ value: round2(Math.abs(plan.tax)), itemStyle: { color: refund ? t.series[1] : t.ink3 } });
  base.push(0); vis.push({ value: round2(plan.net), itemStyle: { color: t.series[2] } });
  return {
    ...chartBase(t),
    tooltip: { ...chartBase(t).tooltip, trigger: 'item', formatter: p => p.seriesName === '_base' ? '' : tipRow(p.color, p.name, (p.name === 'Steuer' || p.name === 'Gebühren' ? '− ' : p.name === 'Erstattung' ? '+ ' : '') + fmtEur(p.value)) },
    xAxis: chartCatAxis(t, cats),
    yAxis: chartValueAxis(t),
    series: [
      { name: '_base', type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
      { name: 'Betrag', type: 'bar', stack: 'w', barMaxWidth: 48, data: vis, itemStyle: { borderRadius: 4 },
        label: { show: true, position: 'top', color: t.ink2, fontFamily: t.fontNum, formatter: p => fmtEur(p.value) } },
    ],
  };
}
