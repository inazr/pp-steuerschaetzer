export default ({ g, check, near }) => {
  const param = g('param'), taxRate = g('taxRate'), FUND_TYPES = g('FUND_TYPES'), LAW = g('LAW');
  const s = (k, b = 'default') => ({ kirchensteuer: k, bundesland: b, veranlagung: 'single' });
  check('law: rate without KiSt', near(taxRate(s(false), 2025), 0.26375, 1e-9), taxRate(s(false), 2025));
  check('law: rate KiSt 9 %', near(taxRate(s(true), 2025), 0.279951, 1e-6), taxRate(s(true), 2025));
  check('law: rate KiSt 8 % Bayern', near(taxRate(s(true, 'bayern'), 2025), 0.278186, 1e-6), taxRate(s(true, 'bayern'), 2025));
  check('law: SPB 2022 single 801', param('sparerpauschbetrag', 2022).single === 801);
  check('law: SPB 2023 joint 2000', param('sparerpauschbetrag', 2023).joint === 2000);
  check('law: Basiszins 2026', param('basiszins', 2026) === 0.032);
  check('law: Basiszins 2021 negative', param('basiszins', 2021) === -0.0045);
  let err = null; try { param('basiszins', 2017); } catch (e) { err = e; }
  check('law: Basiszins 2017 throws', !!err);
  err = null; try { param('basiszins', 2027); } catch (e) { err = e; }
  check('law: Basiszins needs exact year (2027 unpublished)', !!err);
  check('law: every Basiszins year has a source', Object.keys(LAW.basiszins.values).every(y => LAW.basiszins.source[y]));
  check('law: fund types', FUND_TYPES.aktienfonds.tfs === 0.3 && FUND_TYPES.einzelaktie.vp === false && FUND_TYPES.einzelaktie.tfs === 0
    && FUND_TYPES.immo_ausland.tfs === 0.8 && FUND_TYPES.einzelaktie.bestandsschutz === '2009-01-01');
  // Quellen: alle Basiszinsen mit Fundstelle im BStBl, keine ungeprüften mehr
  const src = g('LAW').basiszins.source;
  check('law: 2026 source has BStBl', src[2026].includes('BStBl I 2026, S. 155'), src[2026]);
  check('law: 2018/2019/2021 verified', src[2018].includes('04.01.2018') && src[2018].includes('BStBl I 2018, S. 249') && src[2019].includes('09.01.2019')
    && src[2019].includes('BStBl I 2019, S. 58') && src[2021].includes('BStBl I 2021, S. 56'), [src[2018], src[2019], src[2021]]);
  check('law: no unverified sources left', Object.values(src).every(x => !x.includes('nicht online gegengeprüft')));
};
