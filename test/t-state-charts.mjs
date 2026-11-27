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
  const v3 = mem(); v3.setItem('pp-steuerschaetzer-v1', JSON.stringify({ genutzt: { '2026|A,B': 300 } }));
  check('state: 0.3 genutzt keys discarded', JSON.stringify(load(v3).genutzt) === '{}' && load(v3).settingsVersion === 4, load(v3));
  check('state: new fields default', ['bankOf', 'fsa', 'vortrag', 'zinsen'].every(k => JSON.stringify(def[k]) === '{}'));
  check('state: altFb default {}', JSON.stringify(def.altFb) === '{}', def);
  const af = mem(); af.setItem('pp-steuerschaetzer-v1', JSON.stringify({ altFb: 'kaputt' }));
  check('state: altFb non-object migrates to {}', JSON.stringify(load(af).altFb) === '{}', load(af));
  const afOld = mem(); afOld.setItem('pp-steuerschaetzer-v1', JSON.stringify({ altFb: { 'A,B': 5000, '2026|A': 7000 } }));
  check('state I1: undated altFb keys dropped, dated kept', JSON.stringify(load(afOld).altFb) === '{"2026|A":7000}', load(afOld));
  const v4 = mem(); save(v4, { ...def, genutzt: { '2026|A': 5 } });
  check('state: v4 genutzt kept', JSON.stringify(load(v4).genutzt) === '{"2026|A":5}', load(v4));
  const syb = g('setYearBank'), sk = g('setKey');
  check('state: setYearBank drops other years', JSON.stringify(syb({ '2025|A': 1, '2026|B': 2 }, 2026, 'A', 5)) === '{"2026|B":2,"2026|A":5}');
  check('state: setYearBank null clears', JSON.stringify(syb({ '2026|A': 1 }, 2026, 'A', null)) === '{}');
  const sybk = g('setYearBankKeep');
  check('state: setYearBankKeep keeps other years', JSON.stringify(sybk({ '2019|A': { aktien: 1, allg: 2 }, '2026|B': 3 }, 2026, 'A', { aktien: 0, allg: 5 }))
    === '{"2019|A":{"aktien":1,"allg":2},"2026|B":3,"2026|A":{"aktien":0,"allg":5}}');
  check('state I1: altFb setter keeps other years and selections', JSON.stringify(sybk({ '2025|A': 80000, '2026|A,B': 1 }, 2026, 'A', 50000)) === '{"2025|A":80000,"2026|A,B":1,"2026|A":50000}');
  check('state: setYearBankKeep null clears only that key', JSON.stringify(sybk({ '2019|A': 1, '2026|A': 2 }, 2026, 'A', null)) === '{"2019|A":1}');
  check('state: setKey set/clear', JSON.stringify(sk({ a: 1 }, 'b', 2)) === '{"a":1,"b":2}' && JSON.stringify(sk({ a: 1 }, 'a', null)) === '{}');
  // Final review I1: Vortrag je Feld; nur Eingetipptes wird gespeichert, leere Einträge fallen weg
  const svf = g('setVortragField');
  check('state I1: vortrag field stores only the typed field', JSON.stringify(svf({ '2019|A': { aktien: 1, allg: 2 } }, 2026, 'A', 'allg', 150))
    === '{"2019|A":{"aktien":1,"allg":2},"2026|A":{"aktien":null,"allg":150}}');
  check('state I1: vortrag field keeps the other typed field', JSON.stringify(svf({ '2026|A': { aktien: 5, allg: 150 } }, 2026, 'A', 'allg', null)) === '{"2026|A":{"aktien":5,"allg":null}}');
  check('state I1: vortrag entry removed when both fields empty', JSON.stringify(svf({ '2019|A': 1, '2026|A': { aktien: null, allg: 150 } }, 2026, 'A', 'allg', null)) === '{"2019|A":1}');
  // Final review M4: Bank-Zuordnung ohne Ketten – wer X folgt, folgt mit X zum neuen Ziel
  const ab = g('assignBank');
  check('state M4: assign re-points members of the moved bank', JSON.stringify(ab({ C: 'A', kA: 'A', kB: 'B' }, 'A', 'B')) === '{"C":"B","kA":"B","kB":"B","A":"B"}', ab({ C: 'A', kA: 'A', kB: 'B' }, 'A', 'B'));
  check('state M4: own bank deletes only the entry, members stay', JSON.stringify(ab({ A: 'B', C: 'A' }, 'A', null)) === '{"C":"A"}', ab({ A: 'B', C: 'A' }, 'A', null));
  const D3 = { portfolios: [{ uuid: 'A' }, { uuid: 'B' }, { uuid: 'C' }], accounts: [], interest: [] };
  const m3 = g('bankMembers')(D3, { depots: ['A', 'B', 'C'], bankOf: ab({ C: 'A' }, 'A', 'B') });
  check('state M4: chained assignment keeps the group together', m3.length === 1 && m3[0].key === 'B' && JSON.stringify(m3[0].depots) === '["A","B","C"]', m3);
  check('state M4: assigning to itself means own bank', JSON.stringify(ab({ A: 'B' }, 'A', 'A')) === '{}');
  // Minor 7: Ziel T mit veraltetem Eintrag (zeigt auf ein abgewähltes Depot Z) – der Eintrag von T fällt weg, T bleibt Gründer
  const D7 = { portfolios: [{ uuid: 'T' }, { uuid: 'X' }, { uuid: 'Z' }], accounts: [], interest: [] };
  const b7 = ab({ T: 'Z' }, 'X', 'T');
  check('state minor 7: stale entry of the target is removed', JSON.stringify(b7) === '{"X":"T"}', b7);
  const m7 = g('bankMembers')(D7, { depots: ['T', 'X', 'Z'], bankOf: b7 });
  check('state minor 7: target stays founder when Z is selected again', m7.some(b => b.key === 'T' && JSON.stringify(b.depots) === '["T","X"]'), m7);
  const sel = g('selectedDepots'), nextOff = g('nextDepotsOff');
  check('depots: unknown default on', JSON.stringify(sel({ depotsOff: ['X'] }, ['A', 'B'])) === '["A","B"]');
  check('depots: deselected stays off', JSON.stringify(sel({ depotsOff: ['B'] }, ['A', 'B'])) === '["A"]');
  check('depots: all off -> all on', JSON.stringify(sel({ depotsOff: ['A', 'B'] }, ['A', 'B'])) === '["A","B"]');
  check('depots: other file kept', JSON.stringify(nextOff({ depotsOff: ['K'] }, ['A', 'B'], ['A']).sort()) === '["B","K"]');
  const conf = g('confirmFundTypes');
  const cs = [{ uuid: 'a', name: 'Siemens AG', isin: 'DE0007236101' }, { uuid: 'b', name: 'X', isin: 'IE00X' }, { uuid: 'c', name: 'Ohne ISIN ETF', isin: '' }];
  const cft = conf({ fundTypes: { IE00X: 'mischfonds' } }, cs);
  check('confirm: guess stored, explicit kept, uuid key without isin', cft.DE0007236101 === 'einzelaktie' && cft.IE00X === 'mischfonds' && cft.c === 'aktienfonds', cft);
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
  // Erstattung (negative Steuer): Balken nach oben von Brutto − Gebühren bis Netto
  const owr = g('optWaterfall')({ ...plan, tax: -50, net: 1550 }, data, TOK);
  const visr = owr.series.find(s => s.name !== '_base'), baser = owr.series.find(s => s.name === '_base');
  check('chart waterfall: refund bar', owr.xAxis.data[2] === 'Erstattung' && near(baser.data[2], 1500) && near(visr.data[2].value, 50) && near(visr.data.at(-1).value, 1550), [owr.xAxis.data, baser.data, visr.data]);
  // Final review M7: gleiche Schwelle wie die Kennzahl (isRefund): −0,001 € ist Steuer, keine Erstattung
  const owt = g('optWaterfall')({ ...plan, tax: -0.001, net: 1500.001 }, data, TOK);
  check('chart M7: rounding-level negative tax is not a refund', owt.xAxis.data[2] === 'Steuer' && g('isRefund')(-0.006) && !g('isRefund')(-0.004), owt.xAxis.data);
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

  // Altbestand (Spec §7): Einstand ab 2018 = Kurs 31.12.2017 (50), ursprünglich 30; Kurs heute 100, Aktienfonds (TFS 30 %)
  const altLot = (buyDate, pre2009) => ({ depot: 'A', security: 'S', buyDate, cost: 50, origCost: 30, alt: { price: 50, gainPS: 20, pre2009 }, vpCum: 0, shares: 10 });
  const gp = g('gainParts'), AF = g('FUND_TYPES').aktienfonds;
  const altRes = lots => ({ lots, latest: new Map([['S', ['2025-01-01', 100]]]) });
  const pre = g('optLotGains')(altRes([altLot('2005-03-01', true)]), data, { fundTypes: {} }, TOK);
  const pv = pre.series.map(x => v(x.data[0]));
  // vor 2009: steuerpflichtig = Neugewinn 50 × 10 × 0,7 = 350; brutto ab ursprünglichem Einstand 70 × 10 = 700; steuerfrei 350 (TFS 150 + Altgewinn 200)
  check('chart lots alt: pre-2009 taxable = gainParts().taxable × shares', near(pv[0][1], gp(altLot('2005-03-01', true), 100, AF).taxable * 10) && near(pv[0][1], 350), pv);
  check('chart lots alt: pre-2009 old gain counts as tax-free', near(pv[1][1], 350) && near(pv[0][1] + pv[1][1], 700), pv);
  const mid = g('optLotGains')(altRes([altLot('2015-06-01', false)]), data, { fundTypes: {} }, TOK);
  const mdv = mid.series.map(x => v(x.data[0]));
  // 2009–2017: steuerpflichtig = 350 + Altgewinn 200 = 550, steuerfrei nur die TFS 150
  check('chart lots alt: 2009–2017 old gain taxable', near(mdv[0][1], 550) && near(mdv[1][1], 150), mdv);
  const ptip = pre.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 });
  check('chart lots alt: tooltip shows original cost and cost from 2018', ptip.includes('Einstand ab 2018') && ptip.includes('50,00') && ptip.includes('ursprünglich') && ptip.includes('30,00') && ptip.includes('700,00'), ptip);
  check('chart lots alt: tooltip marks pre-2009', ptip.includes('vor 2009 (Bestandsschutz Altgewinn)'), ptip);
  check('chart lots alt: tooltip marks 2009–2017', mid.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }).includes('2009–2017 (Altgewinn steuerpflichtig)'));
  check('chart lots alt: plain lot has no old-holdings line', !two.tooltip.formatter({ seriesIndex: 0, dataIndex: 0 }).includes('Einstand ab 2018'));
  // Ø-Einstand je Markierung, gewichtet nach Stück: (30·10 + 40·30) / 40 = 37,50; ab 2018 (50·10 + 60·30) / 40 = 57,50
  const ag = g('altGroups')([altLot('2015-06-01', false), lot('S'), altLot('2005-03-01', true), { ...altLot('2006-01-02', true), shares: 30, origCost: 40, cost: 60 }]);
  check('altGroups: pre-2009 first, share-weighted averages, plain lots ignored', ag.length === 2 && ag[0].pre2009 && ag[0].shares === 40 && near(ag[0].orig, 37.5) && near(ag[0].cost, 57.5)
    && !ag[1].pre2009 && near(ag[1].orig, 30), ag);
  const am = g('altMark');
  check('altMark: labels', am(altLot('2005-03-01', true)) === 'vor 2009 (Bestandsschutz Altgewinn)' && am(altLot('2015-06-01', false)) === '2009–2017 (Altgewinn steuerpflichtig)' && am(lot('S')) === '');

  // B8: gespeicherte Einstellungen werden geprüft
  const st8 = v => ({ getItem: () => JSON.stringify({ settingsVersion: 4, ...v }) });
  const bad8 = g('loadSettings')(st8({ veranlagung: 'xx', kirchensteuer: 'ja', bundesland: 5, gebuehrFix: 'abc', gebuehrProz: -1, depotsOff: [1, null, 'u'] }));
  check('B8: invalid settings fall back', bad8.veranlagung === 'single' && bad8.kirchensteuer === false && bad8.bundesland === 'default' && bad8.gebuehrFix === 0 && bad8.gebuehrProz === 0 && JSON.stringify(bad8.depotsOff) === '["u"]', bad8);
  const ok8 = g('loadSettings')(st8({ veranlagung: 'joint', kirchensteuer: true, bundesland: 'bayern', gebuehrFix: 9.9, gebuehrProz: 0.25 }));
  check('B8: valid settings kept', ok8.veranlagung === 'joint' && ok8.kirchensteuer === true && ok8.bundesland === 'bayern' && ok8.gebuehrFix === 9.9 && ok8.gebuehrProz === 0.25, ok8);
};
