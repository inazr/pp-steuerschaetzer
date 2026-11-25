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
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    legend: chartLegend(t, true),
    tooltip: { ...chartBase(t).tooltip, trigger: 'item', formatter: p => tipRow(p.color, p.seriesName, fmtEur(p.value)) },
    xAxis: { ...chartValueAxis(t), max: a.total },
    yAxis: { type: 'category', data: ['Freibetrag'], show: false },
    series: parts.map(([name, v, color]) => ({ name, type: 'bar', stack: 'fb', barWidth: 28, data: [round2(Math.min(v, a.total))], itemStyle: { color, borderColor: t.surface, borderWidth: 2 } })),
  };
}

function optLotGains(result, data, settings, t) {
  const multiDepot = new Set(result.lots.map(l => l.depot)).size > 1;
  const lots = result.lots.filter(l => result.latest.has(l.security));
  const label = l => {
    const s = data.securities.find(x => x.uuid === l.security) || {};
    const d = multiDepot ? ' · ' + ((data.portfolios.find(p => p.uuid === l.depot) || {}).name || '') : '';
    return `${s.name} · ${fmtDate(l.buyDate)}${d}`;
  };
  const brutto = lots.map(l => round2((result.latest.get(l.security)[1] - l.cost) * l.shares));
  const taxable = lots.map(l => { const g = taxableGainPerShare(l, result.latest.get(l.security)[1], settings, data); return g === null ? 0 : round2(g * l.shares); });
  return {
    ...chartBase(t),
    legend: chartLegend(t, true),
    tooltip: { ...chartBase(t).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: ps => tipHead(ps[0].axisValue) + ps.map(p => tipRow(p.color, p.seriesName, fmtEur(p.value))).join('') },
    xAxis: chartValueAxis(t),
    yAxis: { ...chartCatAxis(t, lots.map(label)), inverse: true },
    dataZoom: lots.length > 14 ? [{ type: 'slider', yAxisIndex: 0, right: 0, width: 14, startValue: 0, endValue: 13, brushSelect: false }, { type: 'inside', yAxisIndex: 0 }] : [],
    series: [
      { name: 'Gewinn brutto', type: 'bar', barMaxWidth: 12, data: brutto, itemStyle: { color: t.series[0], borderRadius: 4 } },
      { name: 'Gewinn steuerpflichtig', type: 'bar', barMaxWidth: 12, data: taxable, itemStyle: { color: t.series[1], borderRadius: 4 } },
    ],
  };
}

function optWaterfall(plan, data, t) {
  const bySec = [];
  for (const r of plan.rows) {
    let e = bySec.find(x => x.uuid === r.lot.security);
    if (!e) bySec.push(e = { uuid: r.lot.security, name: (data.securities.find(s => s.uuid === r.lot.security) || {}).name, gross: 0 });
    e.gross += r.gross;
  }
  const cats = [...bySec.map(e => e.name), 'Steuer', 'Netto'];
  const base = [], vis = [];
  let acc = 0;
  for (const e of bySec) { base.push(round2(acc)); vis.push({ value: round2(e.gross), itemStyle: { color: secColor(t, data, e.uuid) } }); acc += e.gross; }
  base.push(round2(plan.net)); vis.push({ value: round2(plan.tax), itemStyle: { color: t.ink3 } });
  base.push(0); vis.push({ value: round2(plan.net), itemStyle: { color: t.series[2] } });
  return {
    ...chartBase(t),
    tooltip: { ...chartBase(t).tooltip, trigger: 'item', formatter: p => p.seriesName === '_base' ? '' : tipRow(p.color, p.name, (p.name === 'Steuer' ? '− ' : '') + fmtEur(p.value)) },
    xAxis: chartCatAxis(t, cats),
    yAxis: chartValueAxis(t),
    series: [
      { name: '_base', type: 'bar', stack: 'w', data: base, itemStyle: { color: 'transparent' }, emphasis: { disabled: true }, tooltip: { show: false } },
      { name: 'Betrag', type: 'bar', stack: 'w', barMaxWidth: 48, data: vis, itemStyle: { borderRadius: 4 },
        label: { show: true, position: 'top', color: t.ink2, fontFamily: t.fontNum, formatter: p => fmtEur(p.value) } },
    ],
  };
}
