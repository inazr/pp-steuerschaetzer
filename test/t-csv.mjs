const data = { securities: [{ uuid: 'S', name: 'ETF; "World"', isin: 'IE00X', currency: 'EUR' }], portfolios: [{ uuid: 'A', name: 'Depot A' }] };
const lot = { id: 1, depot: 'A', security: 'S', buyDate: '2020-03-15', shares: 1.123456789, cost: 95.5, vpCum: 0 };
const sp = s => s.replace(/ | /g, ' ');

export default ({ g, check }) => {
  const fmtEur = g('fmtEur'), fmtPct = g('fmtPct'), fmtDate = g('fmtDate'), fmtShares = g('fmtShares');
  check('fmt: eur', sp(fmtEur(1234.5)) === '1.234,50 €', fmtEur(1234.5));
  check('fmt: eur negative', sp(fmtEur(-3)) === '-3,00 €', fmtEur(-3));
  check('fmt: pct', sp(fmtPct(0.26375)) === '26,38 %', fmtPct(0.26375));
  check('fmt: date', fmtDate('2024-06-20') === '20.06.2024');
  check('fmt: shares', fmtShares(12.5) === '12,5' && fmtShares(1234.56789) === '1.234,5679' && fmtShares(3) === '3', [fmtShares(12.5), fmtShares(1234.56789)]);

  const vp = g('csvVp')([{ year: 2023, depot: 'A', security: 'S', wertAnfang: 10000, wertEnde: 12000, basiszins: 0.0255, basisertrag: 178.5, wertsteigerung: 2000, ausschuettungen: 0, vp: 178.5, tfs: 0.3, taxable: 124.95, tax: 32.96 }], data);
  const lines = vp.split('\r\n');
  check('csv: BOM', vp.startsWith('﻿'));
  check('csv vp: header', lines[0] === '﻿Jahr;Depot;Wertpapier;ISIN;Wert 01.01.;Wert 31.12.;Basiszins;Basisertrag;Wertsteigerung;Ausschüttungen;Vorabpauschale;Teilfreistellung;Steuerpflichtig;Steuer', lines[0]);
  check('csv vp: row', lines[1] === '2023;Depot A;"ETF; ""World""";IE00X;10000,00;12000,00;2,55 %;178,50;2000,00;0,00;178,50;30,00 %;124,95;32,96', lines[1]);
  check('csv: CRLF terminated', vp.endsWith('\r\n'));

  // Spalte „Bank“ zuerst: Label aus res.banks, sonst Name des gründenden Depots/Kontos
  const fb = g('csvAllowance')({ rows: [{ bank: 'A', lot, shares: 1.123456789, price: 100, gross: 112.35, gainTaxable: 3.54 }], banks: [{ key: 'A', label: 'Hausbank' }] }, data);
  const fl = fb.split('\r\n');
  check('csv fb: header', fl[0] === '﻿Bank;Depot;Wertpapier;ISIN;Stück;Kaufdatum;Einstandskurs;Aktueller Kurs;Brutto-Erlös;Gewinn steuerpflichtig', fl[0]);
  check('csv fb: bank label, shares 8 dp, date', fl[1] === 'Hausbank;Depot A;"ETF; ""World""";IE00X;1,12345679;15.03.2020;95,50;100,00;112,35;3,54', fl[1]);
  const fb2 = g('csvAllowance')({ rows: [{ bank: 'A', lot, shares: 1, price: 100, gross: 100, gainTaxable: 4.5 }] }, data).split('\r\n');
  check('csv fb: bank label falls back to founder name', fb2[1].startsWith('Depot A;Depot A;'), fb2[1]);

  // Verkaufsplan: Steuerbasis und Freibetrag sind Änderungen (Δ) und können negativ sein; negative Steuer = Erstattung
  const pl = g('csvPlan')({ rows: [{ bank: 'A', lot, shares: 2, price: 100, gross: 200, fee: 5.5, gain: -9, taxable: -6.3, allowance: -2, tax: -1.66, net: 196.16, exempt: false }], banks: [{ key: 'A', label: 'Hausbank' }] }, data);
  const pls = pl.split('\r\n');
  check('csv plan: header', pls[0] === '﻿Bank;Depot;Wertpapier;ISIN;Stück;Kaufdatum;Einstandskurs;Aktueller Kurs;Brutto-Erlös;Gebühr;Gewinn;Steuerbasis Δ;Freibetrag Δ;Steuer (negativ = Erstattung);Netto-Erlös', pls[0]);
  check('csv plan: row', pls[1] === 'Hausbank;Depot A;"ETF; ""World""";IE00X;2;15.03.2020;95,50;100,00;200,00;5,50;-9,00;-6,30;-2,00;-1,66;196,16', pls[1]);
  // T7: Spalte „Erstattung später (Richtwert)“ nur, wenn eine Zeile eine erwartete Erstattung hat (sonst wie 0.4, s. oben)
  const plr = g('csvPlan')({ rows: [{ bank: 'A', lot, shares: 2, price: 100, gross: 200, fee: 0, gain: 9, taxable: 6.3, allowance: 0, tax: 1.66, net: 198.34, exempt: false, refund: 1.66 },
    { bank: 'A', lot, shares: 1, price: 100, gross: 100, fee: 0, gain: 4, taxable: 2.8, allowance: 0, tax: 0.74, net: 99.26, exempt: false, refund: 0 }] }, data).split('\r\n');
  check('csv plan T7: refund column header', plr[0] === '﻿Bank;Depot;Wertpapier;ISIN;Stück;Kaufdatum;Einstandskurs;Aktueller Kurs;Brutto-Erlös;Gebühr;Gewinn;Steuerbasis Δ;Freibetrag Δ;Steuer (negativ = Erstattung);Netto-Erlös;Erstattung später (Richtwert)', plr[0]);
  check('csv plan T7: refund per row', plr[1].endsWith(';1,66;198,34;1,66') && plr[2].endsWith(';0,74;99,26;0,00'), plr);
  const pl0 = g('csvPlan')({ rows: [{ bank: 'A', lot, shares: 1, price: 100, gross: 100, fee: 0, gain: 4, taxable: 2.8, allowance: 0, tax: 0.74, net: 99.26, exempt: false, refund: 0 }] }, data).split('\r\n');
  check('csv plan T7: no refund column when all refunds 0', !pl0[0].includes('Erstattung später') && pl0[1].endsWith(';0,74;99,26'), pl0);
  // Altbestand-Freibetrag: Gewinn vor TFS, Bankabzug, erwartete Erstattung
  const al = g('csvAltFreibetrag')({ rows: [{ bank: 'A', lot, shares: 2, price: 100, gross: 200, raw: 9, used: 6.3, bankTax: 1.66, refund: 1.66 }] }, data).split('\r\n');
  check('csv alt: header', al[0] === '﻿Bank;Depot;Wertpapier;ISIN;Stück;Kaufdatum;Einstandskurs;Aktueller Kurs;Brutto-Erlös;Gewinn (vor TFS);Freibetrag verbraucht;Bankabzug;Erstattung erwartet', al[0]);
  check('csv alt: row', al[1] === 'Depot A;Depot A;"ETF; ""World""";IE00X;2;15.03.2020;95,50;100,00;200,00;9,00;6,30;1,66;1,66', al[1]);
  // Bank-Label aus res.banks (wie csvAllowance/csvPlan)
  const al2 = g('csvAltFreibetrag')({ rows: [{ bank: 'A', lot, shares: 2, price: 100, gross: 200, raw: 9, used: 6.3, bankTax: 1.66, refund: 1.66 }], banks: [{ key: 'A', label: 'Hausbank' }] }, data).split('\r\n');
  check('csv alt: bank label from res.banks', al2[1].startsWith('Hausbank;Depot A;'), al2[1]);
};
