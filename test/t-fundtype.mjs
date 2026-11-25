// Fondstyp-Heuristik: PP-Dateien haben kein Typ-Feld, also ISIN-Präfix und Name
export default ({ g, check }) => {
  const guess = g('guessFundType'), of = g('fundTypeOf'), guessed = g('fundTypeGuessed'), FT = g('FUND_TYPES');
  const S = (name, isin = '') => ({ uuid: 'u-' + name, name, isin });
  check('ft: IE broker abbreviation -> aktienfonds', guess(S('VANG FTSE AW USDD', 'IE00BK5BQT80')) === 'aktienfonds');
  check('ft: LU prefix -> aktienfonds', guess(S('XYZ', 'LU0000000000')) === 'aktienfonds');
  check('ft: name ETF, DE isin -> aktienfonds', guess(S('Some Index ETF', 'DE000A0000X1')) === 'aktienfonds');
  check('ft: govt bond ETF -> sonstige', guess(S('iShares Core € Govt Bond UCITS ETF', 'IE00B4WXJJ64')) === 'sonstige');
  check('ft: money market -> sonstige', guess(S('Xtrackers II EUR Overnight Rate Swap', 'LU0290358497')) === 'sonstige');
  check('ft: Xetra-Gold -> sonstiges_wp', guess(S('Xetra-Gold', 'DE000A0S9GB0')) === 'sonstiges_wp');
  check('ft: ETC beats fund words (rule 1 before 3)', guess(S('WisdomTree Physical Gold ETC', 'JE00B1VS3770')) === 'sonstiges_wp');
  check('ft: DE stock -> einzelaktie', guess(S('Siemens AG', 'DE0007236101')) === 'einzelaktie');
  check('ft: US stock with Union in name -> einzelaktie', guess(S('Union Pacific Corp', 'US9078181081')) === 'einzelaktie');
  check('ft: no isin, name only', guess(S('Apple Inc.')) === 'einzelaktie' && guess(S('MSCI World ETF')) === 'aktienfonds');
  check('ft: bond without fund signal is not sonstige', guess(S('Bundesanleihe 2030', 'DE0001102000')) === 'sonstiges_wp');
  check('ft: Irish stock with company suffix -> einzelaktie', guess(S('Linde plc', 'IE000S9YS762')) === 'einzelaktie' && guess(S('ArcelorMittal S.A.', 'LU1598757687')) === 'einzelaktie');
  check('ft: Acc only as whole word', guess(S('Accenture plc', 'IE00B4BNMY34')) === 'einzelaktie' && guess(S('Core MSCI World (Acc)', 'IE00B4L5Y983')) === 'aktienfonds');
  check('ft: provider brand with company suffix is a stock', guess(S('Amundi SA', 'FR0004125920')) === 'einzelaktie' && guess(S('Amundi Prime Global', 'LU2089238203')) === 'aktienfonds');
  check('ft: bond fund named Anleihen -> sonstige', guess(S('iShares Euro Unternehmensanleihen UCITS ETF', 'IE00B3F81R35')) === 'sonstige');
  // Review: verbreitete deutsche/französische Publikumsfonds und Broker-Kürzel
  const funds = [['UniGlobal', 'DE0008491051'], ['UniRak', 'DE0008491044'], ['Concentra A (EUR)', 'DE0008475005'], ['Fondak A (EUR)', 'DE0008471012'],
    ['hausInvest', 'DE0009807016'], ['grundbesitz europa RC', 'DE0009807008'], ['Carmignac Patrimoine A EUR', 'FR0010135103'], ['Comgest Monde C', 'FR0000284689'],
    ['ISHS CORE DAX', 'DE0005933931'], ['XTR.MSCI WORLD 1C', 'IE00BJ0KDQ92'], ['Flossbach von Storch SICAV', 'LU0323578657']];
  check('ft: common mutual funds -> fund', funds.every(([n, i]) => guess(S(n, i)) === 'aktienfonds'), funds.map(([n, i]) => [n, guess(S(n, i))]));
  check('ft: bond/money compounds -> sonstige', guess(S('Allianz Rentenfonds A EUR', 'DE0008471400')) === 'sonstige' && guess(S('Deka-Geldmarktfonds', 'DE0009771824')) === 'sonstige'
    && guess(S('Amundi € STR', 'FR0010510800')) === 'sonstige', [guess(S('Allianz Rentenfonds A EUR', 'DE0008471400')), guess(S('Deka-Geldmarktfonds', 'DE0009771824')), guess(S('Amundi € STR', 'FR0010510800'))]);
  check('ft: corp bond funds are funds', guess(S('ISHSII-EO CORP BD LAR.CAP', 'IE00B3F81R35')) === 'sonstige' && guess(S('Xtrackers II EUR Corp Bond', 'LU0478205379')) === 'sonstige',
    [guess(S('ISHSII-EO CORP BD LAR.CAP', 'IE00B3F81R35')), guess(S('Xtrackers II EUR Corp Bond', 'LU0478205379'))]);
  check('ft: Jersey ETCs -> sonstiges_wp', guess(S('WisdomTree Physical Swiss Gold', 'JE00B588CD74')) === 'sonstiges_wp' && guess(S('WisdomTree Copper', 'JE00B78CGV99')) === 'sonstiges_wp');
  check('ft: abbreviated federal bond -> sonstiges_wp', guess(S('Bundesrep.Deutschland Anl.v.2014(2024)', 'DE0001102358')) === 'sonstiges_wp');
  const stocks = [['Unilever PLC', 'GB00B10RZP78'], ['Unilever', 'GB00B10RZP78'], ['UniCredit S.p.A.', 'IT0005239360'], ['Glencore plc', 'JE00B4T3BW64'],
    ['Fidelity National Information Services Inc.', 'US31620M1062'], ['Industrial Logistics Properties Trust', 'US4562371066']];
  check('ft: extended lists do not hit stocks', stocks.every(([n, i]) => guess(S(n, i)) === 'einzelaktie'), stocks.map(([n, i]) => [n, guess(S(n, i))]));
  const sec = S('Siemens AG', 'DE0007236101');
  check('ft: explicit wins', of({ fundTypes: { DE0007236101: 'mischfonds' } }, sec) === 'mischfonds' && !guessed({ fundTypes: { DE0007236101: 'mischfonds' } }, sec));
  check('ft: unknown explicit key -> guess', of({ fundTypes: { DE0007236101: 'kaputt' } }, sec) === 'einzelaktie' && guessed({ fundTypes: { DE0007236101: 'kaputt' } }, sec));
  check('ft: uuid key when no isin', of({ fundTypes: { 'u-Foo': 'sonstige' } }, S('Foo')) === 'sonstige');
  check('ft: sonstiges_wp shape', FT.sonstiges_wp.tfs === 0 && FT.sonstiges_wp.vp === false && !FT.sonstiges_wp.bestandsschutz);
};
