// Namen aus der PP-Datei dürfen in Tooltips (HTML) nie als Markup landen
const TOK = { ink: '#111', ink2: '#444', ink3: '#777', line: '#ddd', surface: '#fff', series: ['#a1', '#a2', '#a3'], fontUi: 'x', fontNum: 'y' };
const EVIL = '<img src=x onerror=alert(1)>';
export default ({ g, check }) => {
  const data = { securities: [{ uuid: 'S', name: EVIL, isin: 'I' }], portfolios: [{ uuid: 'A', name: EVIL }] };
  const vp = g('optVpByYear')([{ year: 2023, depot: 'A', security: 'S', vp: 10, tax: 2 }], data, TOK);
  const html1 = vp.tooltip.formatter([{ axisValue: EVIL, color: '#a1', seriesName: EVIL, value: 10, data: { tax: 2 } }]);
  check('xss: vp tooltip escapes names', !html1.includes('<img'), html1);
  const lots = g('optLotGains')({ lots: [{ depot: 'A', security: 'S', buyDate: '2020-01-01', cost: 1, vpCum: 0, shares: 1 }], latest: new Map([['S', ['2025-01-01', 2]]]) }, data, { fundTypes: {} }, TOK);
  const html2 = lots.tooltip.formatter([{ axisValue: lots.yAxis.data[0], color: '#a1', seriesName: 'Gewinn brutto', value: 1 }]);
  check('xss: lot tooltip escapes names', !html2.includes('<img'), html2);
  const wf = g('optWaterfall')({ net: 1, tax: 0, rows: [{ lot: { security: 'S' }, gross: 1 }] }, data, TOK);
  const html3 = wf.tooltip.formatter({ seriesName: 'Betrag', color: '#a1', name: EVIL, value: 1 });
  check('xss: waterfall tooltip escapes names', !html3.includes('<img'), html3);
};
