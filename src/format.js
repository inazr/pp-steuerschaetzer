// Deutsche Zahlen- und Datumsformate für Anzeige
const NF_EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const NF_PCT = new Intl.NumberFormat('de-DE', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF_SH = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const fmtEur = x => NF_EUR.format(round2(x) || 0);
const fmtPct = x => NF_PCT.format(x);
const fmtDate = iso => isoToDe(iso);
const fmtShares = x => NF_SH.format(x);
// Negative Steuer gilt erst ab einem halben Cent als Erstattung (gleiche Schwelle für Kennzahl und Chart)
const isRefund = tax => tax < -0.005;
// Welche Depots eine Zahl umfasst: "alle Depots" oder "1 von 2 Depots"
const depotScope = (selected, total) => !selected || selected.length >= total ? 'alle Depots' : `${selected.length} von ${total} Depots`;
