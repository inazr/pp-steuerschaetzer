const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m }; };
const TOK = { ink: '#111', ink2: '#444', ink3: '#777', line: '#ddd', surface: '#fff', series: ['#a1', '#a2', '#a3', '#a4', '#a5', '#a6'], fontUi: 'Public Sans', fontNum: 'JetBrains Mono' };
const data = {
  securities: [{ uuid: 'S', name: 'Welt', isin: 'IE01' }, { uuid: 'T', name: 'Schwellenländer', isin: 'IE02' }],
  portfolios: [{ uuid: 'A', name: 'Depot A' }, { uuid: 'B', name: 'Depot B' }],
};

export default ({ g, check, near }) => {
  // Einstellungen
  const load = g('loadSettings'), save = g('saveSettings');
  const st = mem();
  const def = load(st);
  check('state: defaults', def.veranlagung === 'single' && def.kirchensteuer === false && def.bundesland === 'default' && JSON.stringify(def.genutzt) === '{}' && JSON.stringify(def.fundTypes) === '{}', def);
  check('state: depotsOff default', Array.isArray(def.depotsOff) && def.depotsOff.length === 0);
  const old = mem(); old.setItem('pp-steuerschaetzer-v1', JSON.stringify({ genutzt: 250, depotsOff: 'kaputt' }));
  check('state: legacy scalar genutzt discarded', JSON.stringify(load(old).genutzt) === '{}' && JSON.stringify(load(old).depotsOff) === '[]', load(old));
  const usedKey = g('usedKey'), getUsed = g('getUsed'), setUsed = g('setUsed');
  check('used: key sorted', usedKey(2026, ['B', 'A']) === '2026|A,B');
  const s1 = { ...def, genutzt: setUsed({ ...def, genutzt: { '2025|A': 9 } }, 2026, ['A', 'B'], 300) };
  check('used: drops other years', JSON.stringify(s1.genutzt) === '{"2026|A,B":300}', s1.genutzt);
  check('used: per selection', getUsed(s1, 2026, ['B', 'A']) === 300 && getUsed(s1, 2026, ['A']) === null && getUsed(s1, 2027, ['A', 'B']) === null);
  check('used: null clears', JSON.stringify(setUsed(s1, 2026, ['A', 'B'], null)) === '{}');
  const sel = g('selectedDepots'), nextOff = g('nextDepotsOff');
  check('depots: unknown default on', JSON.stringify(sel({ depotsOff: ['X'] }, ['A', 'B'])) === '["A","B"]');
  check('depots: deselected stays off', JSON.stringify(sel({ depotsOff: ['B'] }, ['A', 'B'])) === '["A"]');
  check('depots: all off -> all on', JSON.stringify(sel({ depotsOff: ['A', 'B'] }, ['A', 'B'])) === '["A","B"]');
  check('depots: other file kept', JSON.stringify(nextOff({ depotsOff: ['K'] }, ['A', 'B'], ['A']).sort()) === '["B","K"]');
  check('depots: re-check removes', JSON.stringify(nextOff({ depotsOff: ['B', 'K'] }, ['A', 'B'], ['A', 'B'])) === '["K"]');
  check('state: fee defaults 0', def.gebuehrFix === 0 && def.gebuehrProz === 0, def);
  save(st, { ...def, kirchensteuer: true, fundTypes: { IE01: 'mischfonds' }, txs: [1], prices: 2, lots: 3, depots: ['A'] });
  const raw = JSON.parse(st.getItem('pp-steuerschaetzer-v1'));
  check('state: never persists portfolio data', !('txs' in raw) && !('prices' in raw) && !('lots' in raw) && !('depots' in raw), Object.keys(raw));
  check('state: roundtrip', load(st).kirchensteuer === true && load(st).fundTypes.IE01 === 'mischfonds');
  save(st, { ...def, gebuehrFix: 4.9, gebuehrProz: 0.25 });
  check('state: fees persist', load(st).gebuehrFix === 4.9 && load(st).gebuehrProz === 0.25, load(st));
  check('state: broken storage -> defaults', load({ getItem: () => '{kaputt' }).veranlagung === 'single');
  check('state: throwing storage tolerated', (() => { try { save({ setItem: () => { throw new Error('quota'); } }, def); return true; } catch { return false; } })());

  // VP je Jahr: eine gestapelte Serie je Wertpapier, Farbe folgt dem Wertpapier
  const rows = [
    { year: 2024, depot: 'A', security: 'T', vp: 10, tax: 2 }, { year: 2023, depot: 'A', security: 'S', vp: 100, tax: 20 },
    { year: 2023, depot: 'B', security: 'S', vp: 50, tax: 10 }, { year: 2024, depot: 'A', security: 'S', vp: 70, tax: 14 },
  ];
  const o = g('optVpByYear')(rows, data, TOK);
  check('chart vp: years sorted', JSON.stringify(o.xAxis.data) === '["2023","2024"]', o.xAxis.data);
  check('chart vp: one stacked series per security', o.series.length === 2 && o.series.every(s => s.type === 'bar' && s.stack === 'vp'), o.series.map(s => s.name));
  const sS = o.series.find(s => s.name === 'Welt'), sT = o.series.find(s => s.name === 'Schwellenländer');
  check('chart vp: summed over depots', JSON.stringify(sS.data.map(d => d.value ?? d)) === '[150,70]' && JSON.stringify(sT.data.map(d => d.value ?? d)) === '[0,10]', [sS.data, sT.data]);
  check('chart vp: color by entity order', sS.itemStyle.color === '#a1' && sT.itemStyle.color === '#a2');
  check('chart vp: legend for >=2 series', o.legend && o.legend.show !== false);
  const o1 = g('optVpByYear')(rows.filter(r => r.security === 'T'), data, TOK);
  check('chart vp: filter keeps entity color', o1.series[0].itemStyle.color === '#a2');

  // Freibetrag
  const oa = g('optAllowance')({ total: 1000, used: 300, remaining: 700, harvested: 650 }, TOK);
  const vals = oa.series.map(s => s.data[0]);
  check('chart allowance: segments sum to total', near(vals.reduce((a, b) => a + b, 0), 1000) && near(vals[0], 300) && near(vals[1], 650) && near(vals[2], 50), vals);

  // Wasserfall
  const lot = (sec) => ({ depot: 'A', security: sec, buyDate: '2020-01-01', cost: 50, vpCum: 0, shares: 10 });
  const plan = { gross: 1500, tax: 120.5, net: 1379.5, rows: [{ lot: lot('S'), gross: 1000, tax: 100 }, { lot: lot('T'), gross: 500, tax: 20.5 }] };
  const ow = g('optWaterfall')(plan, data, TOK);
  const vis = ow.series.find(s => s.name !== '_base');
  check('chart waterfall: categories', JSON.stringify(ow.xAxis.data) === '["Welt","Schwellenländer","Steuer","Netto"]', ow.xAxis.data);
  check('chart waterfall: last bar = net', near(vis.data.at(-1).value ?? vis.data.at(-1), 1379.5), vis.data.at(-1));
  const owf = g('optWaterfall')({ ...plan, fees: 10, net: 1369.5 }, data, TOK);
  const visf = owf.series.find(s => s.name !== '_base'), basef = owf.series.find(s => s.name === '_base');
  check('chart waterfall: fees bar before tax', JSON.stringify(owf.xAxis.data) === '["Welt","Schwellenländer","Gebühren","Steuer","Netto"]'
    && near(visf.data[2].value ?? visf.data[2], 10) && near(basef.data[2], 1490) && near(basef.data[3], 1369.5) && near(visf.data.at(-1).value ?? visf.data.at(-1), 1369.5), [owf.xAxis.data, basef.data, visf.data]);
  const base = ow.series.find(s => s.name === '_base');
  check('chart waterfall: tax floats at net', near(base.data[2], 1379.5) && near(vis.data[2].value ?? vis.data[2], 120.5), [base.data[2], vis.data[2]]);

  // Lot-Gewinne: je Wertpapier ein Diagramm untereinander, x = Kaufdatum (Zeit), y = Gewinn in €
  const res = { lots: [lot('S'), { ...lot('T'), cost: 120 }], latest: new Map([['S', ['2025-01-01', 100]], ['T', ['2025-01-01', 100]]]) };
  const ol = g('optLotGains')(res, data, { fundTypes: {} }, TOK);
  const v = x => x?.value ?? x, rad = x => x?.itemStyle?.borderRadius;
  check('chart lots: one panel per security, file order', ol.grid.length === 2 && ol.title.map(x => x.text).join() === 'Welt,Schwellenländer', ol.title);
  check('chart lots: shared time axis', ol.xAxis.every(x => x.type === 'time' && x.min === ol.xAxis[0].min && x.max === ol.xAxis[0].max) && ol.xAxis[0].min < Date.parse('2020-01-01') && ol.xAxis[0].max > Date.parse('2020-01-01'), ol.xAxis.map(x => [x.type, x.min, x.max]));
  check('chart lots: value axis per panel', ol.yAxis.length === 2 && ol.yAxis.every((y, i) => y.type === 'value' && y.gridIndex === i));
  check('chart lots: two stacked parts per panel', ol.series.length === 4 && ol.series.map(x => x.name).join() === 'steuerpflichtig,steuerfrei,steuerpflichtig,steuerfrei'
    && ol.series.every(x => x.type === 'custom' && !x.stack) && ol.series.map(x => x.xAxisIndex).join() === '0,0,1,1' && ol.series.map(x => x.yAxisIndex).join() === '0,0,1,1', ol.series.map(x => [x.name, x.stack, x.xAxisIndex]));
  const val = (si) => v(ol.series[si].data[0]);
  check('chart lots: x = Monday of ISO week, parts add up to gross gain', val(0)[0] === '2019-12-30' && near(val(0)[1], 350) && near(val(1)[1], 150) && near(val(2)[1], -140) && near(val(3)[1], -60), [0, 1, 2, 3].map(val));
  check('chart lots: tax-free part starts where taxable part ends', val(0)[2] === 0 && near(val(1)[2], 350) && near(val(1)[3], 500) && near(val(3)[2], -140) && near(val(3)[3], -200), [0, 1, 2, 3].map(val));
  const mixed = g('optLotGains')({ lots: [{ ...lot('S'), vpCum: 60 }], latest: new Map([['S', ['2025-01-01', 55]]]) }, data, { fundTypes: {} }, TOK);
  const mv = mixed.series.map(x => v(x.data[0]));
  check('chart lots: opposite signs both start at zero', near(mv[0][1], -7) && mv[0][2] === 0 && near(mv[1][1], 57) && mv[1][2] === 0, mv);
  check('chart lots: rounded outer end only', JSON.stringify(rad(ol.series[1].data[0])) === '[4,4,0,0]' && !rad(ol.series[0].data[0]) && JSON.stringify(rad(ol.series[3].data[0])) === '[0,0,4,4]', [ol.series[0].data[0], ol.series[1].data[0], ol.series[3].data[0]]);
  const two = g('optLotGains')({ ...res, lots: [...res.lots, { ...lot('S'), depot: 'B', buyDate: '2020-01-05' }] }, data, { fundTypes: {} }, TOK);
  check('chart lots: same security + calendar week -> one column', two.series[0].data.length === 1 && near(v(two.series[0].data[0])[1], 700), two.series[0].data);
  const tip = two.tooltip.formatter({ seriesIndex: 0, dataIndex: 0, color: '#a2', seriesName: 'steuerpflichtig' });
  check('chart lots: tooltip has date, depots, gross gain and parts', tip.includes('Welt') && tip.includes('KW 1/2020') && tip.includes('01.01.2020') && tip.includes('05.01.2020') && tip.includes('Depot A') && tip.includes('Depot B')
    && tip.includes('Gewinn brutto') && tip.includes('1.000,00') && tip.includes('700,00') && tip.includes('300,00'), tip);
  const wk = g('optLotGains')({ ...res, lots: [lot('S'), { ...lot('S'), buyDate: '2020-01-06' }] }, data, { fundTypes: {} }, TOK);
  check('chart lots: Monday starts a new week', wk.series[0].data.map(x => v(x)[0]).join() === '2019-12-30,2020-01-06', wk.series[0].data.map(v));
  const w53 = g('optLotGains')({ ...res, lots: [{ ...lot('S'), buyDate: '2021-01-01' }] }, data, { fundTypes: {} }, TOK);
  check('chart lots: ISO week-year (01.01.2021 = KW 53/2020)', w53.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }).includes('KW 53/2020'), w53.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }));
  const solo = g('optLotGains')(res, data, { fundTypes: { IE01: 'sonstige' } }, TOK);
  check('chart lots: no tax-free part -> taxable part gets rounded end', JSON.stringify(rad(solo.series[0].data[0])) === '[4,4,0,0]' && near(v(solo.series[1].data[0])[1], 0), [solo.series[0].data[0], solo.series[1].data[0]]);
  const one = g('optLotGains')({ ...res, lots: [lot('S')] }, data, { fundTypes: {} }, TOK);
  const h = g('lotChartHeight');
  check('chart lots: height grows with panels', one.grid.length === 1 && h(ol) > h(one) && h(one) >= 200, [h(one), h(ol)]);
  check('chart lots: panels do not overlap', ol.grid[1].top >= ol.grid[0].top + ol.grid[0].height + 30, ol.grid);
};
