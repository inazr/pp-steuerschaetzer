// CSV-Export für Excel (deutsch): Semikolon, Dezimalkomma, UTF-8 mit BOM, CRLF
const csvCell = v => /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
// Namen aus der Datei, die Excel als Formel läse (=, +, -, @ am Anfang), mit Hochkomma entschärfen – nie auf Zahlen anwenden
const csvText = v => /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
const csvMoney = x => round2(x).toFixed(2).replace('.', ',');
const csvPct = x => (x * 100).toFixed(2).replace('.', ',') + ' %';
const csvShares = x => round8(x).toFixed(8).replace(/\.?0+$/, '').replace('.', ',');
const csvDoc = (header, rows) => '﻿' + [header, ...rows].map(r => r.map(c => csvCell(String(c))).join(';')).join('\r\n') + '\r\n';
const csvNames = (data, depot, security) => {
  const s = secByUuid(data, security) || {};
  return [csvText((data.portfolios.find(p => p.uuid === depot) || {}).name || depot), csvText(s.name || security), s.isin || ''];
};

function csvVp(rows, data) {
  return csvDoc(['Jahr', 'Depot', 'Wertpapier', 'ISIN', 'Wert 01.01.', 'Wert 31.12.', 'Basiszins', 'Basisertrag', 'Wertsteigerung', 'Ausschüttungen', 'Vorabpauschale', 'Teilfreistellung', 'Steuerpflichtig', 'Steuer'],
    rows.map(r => [r.year, ...csvNames(data, r.depot, r.security), csvMoney(r.wertAnfang), csvMoney(r.wertEnde), csvPct(r.basiszins), csvMoney(r.basisertrag),
      csvMoney(r.wertsteigerung), csvMoney(r.ausschuettungen), csvMoney(r.vp), csvPct(r.tfs), csvMoney(r.taxable), csvMoney(r.tax)]));
}

// Bank-Label aus dem Ergebnis (res.banks), sonst Name des gründenden Depots/Kontos
const csvBank = (res, data, key) => csvText(((res.banks || []).find(b => b.key === key) || {}).label || bankLabel(data, key));
const csvLotCols = (r, data) => [...csvNames(data, r.lot.depot, r.lot.security), csvShares(r.shares), fmtDate(r.lot.buyDate), csvMoney(r.lot.cost), csvMoney(r.price), csvMoney(r.gross)];
const CSV_LOT_HEAD = ['Bank', 'Depot', 'Wertpapier', 'ISIN', 'Stück', 'Kaufdatum', 'Einstandskurs', 'Aktueller Kurs', 'Brutto-Erlös'];

function csvAllowance(res, data) {
  return csvDoc([...CSV_LOT_HEAD, 'Gewinn steuerpflichtig'], res.rows.map(r => [csvBank(res, data, r.bank), ...csvLotCols(r, data), csvMoney(r.gainTaxable)]));
}
function csvPlan(plan, data) {
  // Steuerbasis Δ / Freibetrag Δ: Änderung durch die Zeile im Jahressaldo der Bank (kann negativ sein).
  // Erwartete Erstattung (Altbestand) als Richtwert je Zeile – nur, wenn eine Zeile eine hat (sonst Spalten wie 0.4)
  const refund = plan.rows.some(r => r.refund > 0.005);
  return csvDoc([...CSV_LOT_HEAD, 'Gebühr', 'Gewinn', 'Steuerbasis Δ', 'Freibetrag Δ', 'Steuer (negativ = Erstattung)', 'Netto-Erlös', ...(refund ? ['Erstattung später (Richtwert)'] : [])],
    plan.rows.map(r => [csvBank(plan, data, r.bank), ...csvLotCols(r, data), csvMoney(r.fee || 0), csvMoney(r.gain), csvMoney(r.taxable), csvMoney(r.allowance), csvMoney(r.tax), csvMoney(r.net),
      ...(refund ? [csvMoney(r.refund || 0)] : [])]));
}
function csvAltFreibetrag(res, data) {
  return csvDoc([...CSV_LOT_HEAD, 'Gewinn (vor TFS)', 'Freibetrag verbraucht', 'Bankabzug', 'Erstattung erwartet'],
    res.rows.map(r => [csvBank(res, data, r.bank), ...csvLotCols(r, data), csvMoney(r.raw), csvMoney(r.used), csvMoney(r.bankTax), csvMoney(r.refund)]));
}
