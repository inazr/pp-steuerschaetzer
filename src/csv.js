// CSV-Export für Excel (deutsch): Semikolon, Dezimalkomma, UTF-8 mit BOM, CRLF
const csvCell = v => /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
const csvMoney = x => round2(x).toFixed(2).replace('.', ',');
const csvPct = x => (x * 100).toFixed(2).replace('.', ',') + ' %';
const csvShares = x => round8(x).toFixed(8).replace(/\.?0+$/, '').replace('.', ',');
const csvDoc = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(c => csvCell(String(c))).join(';')).join('\r\n') + '\r\n';
const csvNames = (data, depot, security) => {
  const s = data.securities.find(x => x.uuid === security) || {};
  return [(data.portfolios.find(p => p.uuid === depot) || {}).name || depot, s.name || security, s.isin || ''];
};

function csvVp(rows, data) {
  return csvDoc(['Jahr', 'Depot', 'Wertpapier', 'ISIN', 'Wert 01.01.', 'Wert 31.12.', 'Basiszins', 'Basisertrag', 'Wertsteigerung', 'Ausschüttungen', 'Vorabpauschale', 'Teilfreistellung', 'Steuerpflichtig', 'Steuer'],
    rows.map(r => [r.year, ...csvNames(data, r.depot, r.security), csvMoney(r.wertAnfang), csvMoney(r.wertEnde), csvPct(r.basiszins), csvMoney(r.basisertrag),
      csvMoney(r.wertsteigerung), csvMoney(r.ausschuettungen), csvMoney(r.vp), csvPct(r.tfs), csvMoney(r.taxable), csvMoney(r.tax)]));
}

const csvLotCols = (r, data) => [...csvNames(data, r.lot.depot, r.lot.security), csvShares(r.shares), fmtDate(r.lot.buyDate), csvMoney(r.lot.cost), csvMoney(r.price), csvMoney(r.gross)];
const CSV_LOT_HEAD = ['Depot', 'Wertpapier', 'ISIN', 'Stück', 'Kaufdatum', 'Einstandskurs', 'Aktueller Kurs', 'Brutto-Erlös'];

function csvAllowance(res, data) {
  return csvDoc([...CSV_LOT_HEAD, 'Gewinn steuerpflichtig'], res.rows.map(r => [...csvLotCols(r, data), csvMoney(r.gainTaxable)]));
}
function csvPlan(plan, data) {
  return csvDoc([...CSV_LOT_HEAD, 'Gebühr', 'Gewinn', 'Gewinn steuerpflichtig', 'Freibetrag', 'Steuer', 'Netto-Erlös'],
    plan.rows.map(r => [...csvLotCols(r, data), csvMoney(r.fee || 0), csvMoney(r.gain), csvMoney(r.taxable), csvMoney(r.allowance), csvMoney(r.tax), csvMoney(r.net)]));
}
