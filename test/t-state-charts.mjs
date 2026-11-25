const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m }; };
const TOK = { ink: '#111', ink2: '#444', ink3: '#777', line: '#ddd', surface: '#fff', series: ['#a1', '#a2', '#a3', '#a4', '#a5', '#a6'], fontUi: 'Public Sans', fontNum: 'JetBrains Mono' };
const data = {
  securities: [{ uuid: 'S', name: 'Welt', isin: 'I1' }, { uuid: 'T', name: 'Schwellenländer', isin: 'I2' }],
  portfolios: [{ uuid: 'A', name: 'Depot A' }, { uuid: 'B', name: 'Depot B' }],
};

export default ({ g, check, near }) => {
  // Einstellungen
  const load = g('loadSettings'), save = g('saveSettings');
  const st = mem();
  const def = load(st);
  check('state: defaults', def.veranlagung === 'single' && def.kirchensteuer === false && def.bundesland === 'default' && def.genutzt === null && JSON.stringify(def.fundTypes) === '{}', def);
  save(st, { ...def, kirchensteuer: true, fundTypes: { I1: 'mischfonds' }, txs: [1], prices: 2, lots: 3, depots: ['A'] });
  const raw = JSON.parse(st.getItem('pp-steuern-v1'));
  check('state: never persists portfolio data', !('txs' in raw) && !('prices' in raw) && !('lots' in raw) && !('depots' in raw), Object.keys(raw));
  check('state: roundtrip', load(st).kirchensteuer === true && load(st).fundTypes.I1 === 'mischfonds');
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
  const base = ow.series.find(s => s.name === '_base');
  check('chart waterfall: tax floats at net', near(base.data[2], 1379.5) && near(vis.data[2].value ?? vis.data[2], 120.5), [base.data[2], vis.data[2]]);

  // Lot-Gewinne
  const res = { lots: [lot('S'), { ...lot('T'), cost: 120 }], latest: new Map([['S', ['2025-01-01', 100]], ['T', ['2025-01-01', 100]]]) };
  const ol = g('optLotGains')(res, data, { fundTypes: {} }, TOK);
  const v = x => x?.value ?? x, rad = x => x?.itemStyle?.borderRadius;
  check('chart lots: one stacked bar of two parts', ol.series.length === 2 && ol.series.every(x => x.stack === 'gain') && ol.series.map(x => x.name).join() === 'steuerpflichtig,steuerfrei', ol.series.map(x => [x.name, x.stack]));
  const [tx, fr] = ol.series.map(x => x.data.map(v));
  check('chart lots: parts add up to gross gain', near(tx[0], 350) && near(fr[0], 150) && near(tx[1], -140) && near(fr[1], -60), [tx, fr]);
  check('chart lots: rounded outer end only', JSON.stringify(rad(ol.series[1].data[0])) === '[0,4,4,0]' && !rad(ol.series[0].data[0]) && JSON.stringify(rad(ol.series[1].data[1])) === '[4,0,0,4]', [ol.series[0].data[0], ol.series[1].data[0], ol.series[1].data[1]]);
  const tip = ol.tooltip.formatter([{ dataIndex: 0, axisValue: ol.yAxis.data[0], color: '#a2', seriesName: 'steuerpflichtig', value: 350 }]);
  check('chart lots: tooltip shows gross gain', tip.includes('Gewinn brutto') && tip.includes('500,00'), tip);
  const solo = g('optLotGains')(res, data, { fundTypes: { I1: 'sonstige' } }, TOK);
  check('chart lots: no tax-free part -> taxable part gets rounded end', JSON.stringify(rad(solo.series[0].data[0])) === '[0,4,4,0]' && near(v(solo.series[1].data[0]), 0), [solo.series[0].data[0], solo.series[1].data[0]]);
};
