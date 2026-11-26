const E = (kind, amount, year = 2026) => ({ year, date: `${year}-06-01`, owner: 'A', kind, amount });
export default ({ g, check, near }) => {
  const net = g('netYear'), tax = g('taxOf');
  const z = { aktien: 0, allg: 0 };
  let r = net(z, [E('sonst', 500)]);
  check('net: fund gain', r.positive === 500 && r.potsAfter.aktien === 0 && r.potsAfter.allg === 0, r);
  r = net(z, [E('aktie', -300), E('sonst', 500)]);
  check('net: stock loss stays in stock pot', r.positive === 500 && r.potsAfter.aktien === 300, r);
  r = net(z, [E('sonst', -300), E('aktie', 500)]);
  check('net: fund loss offsets stock gain', r.positive === 200 && r.potsAfter.allg === 0, r);
  r = net(z, [E('aktie', -300), E('aktie', 500)]);
  check('net: stock loss offsets stock gain', r.positive === 200 && r.potsAfter.aktien === 0, r);
  r = net({ aktien: 0, allg: 400 }, [E('div', 300)]);
  check('net: carried pot absorbs dividend', r.positive === 0 && r.potsAfter.allg === 100, r);
  r = net({ aktien: 100, allg: 50 }, [E('aktie', 300), E('zins', 20)]);
  check('net: stock gain uses stock pot first, then general', r.positive === 170 && r.potsAfter.aktien === 0 && r.potsAfter.allg === 0, r);
  const t = tax({ A: 500, B: 300 }, { pooled: false, spb: 1000, byBank: { A: 600, B: 100 } }, 0.25);
  check('tax: per bank FSA', t.usedByBank.A === 500 && t.usedByBank.B === 100 && t.taxable === 200 && t.tax === 50, t);
  const p = tax({ A: 700, B: 600 }, { pooled: true, spb: 1000, byBank: {} }, 0.25);
  check('tax: pooled FSA over the sum', p.usedByBank.A + p.usedByBank.B === 1000 && p.taxable === 300, p);
  check('tax: negative positive is 0', tax({ A: -50 }, { pooled: false, spb: 1000, byBank: { A: 1000 } }, 0.25).tax === 0);
  // Minor 6: unbekannte Art wird ignoriert (kein NaN); gemeinsamer Topf je Schritt gerundet (Summe genutzt ≤ spb)
  r = net(z, [E('foo', 5), E('div', 10)]);
  check('net minor 6: unknown kind ignored', r.positive === 10 && !('foo' in r.byKind) && Object.values(r.byKind).every(v => Number.isFinite(v)), r);
  for (const ps of [{ A: 0.005, B: 2000 }, { A: 0.105, B: 0.105, C: 2000 }, { A: 333.335, B: 333.335, C: 333.335, D: 5 }]) {
    const q = tax(ps, { pooled: true, spb: 1000, byBank: {} }, 0.25), su = Object.values(q.usedByBank).reduce((s, u) => s + u, 0);
    check('tax minor 6: pooled used sums to spb, never above', Math.abs(su - 1000) < 1e-9, [ps, q]);
  }
  // Minor 12: taxOf / netYear Randfälle
  const pq = tax({ A: 300, B: 200 }, { pooled: true, spb: 1000, byBank: {} }, 0.25);
  check('tax minor 12: pooled spb above sum of positives', pq.usedByBank.A === 300 && pq.usedByBank.B === 200 && pq.taxable === 0 && pq.tax === 0, pq);
  const mq = tax({ A: 300, B: 200 }, { pooled: false, spb: 1000, byBank: { A: 1000 } }, 0.25);
  check('tax minor 12: bank missing in byBank gets 0', mq.usedByBank.B === 0 && mq.taxable === 200 && mq.tax === 50, mq);
  const pots0 = { aktien: 100, allg: 50 }, before = JSON.stringify(pots0);
  net(pots0, [E('aktie', 300), E('sonst', -80), E('div', 20)]);
  check('net minor 12: input pots not mutated', JSON.stringify(pots0) === before, pots0);
  const members = g('bankMembers'), zinsOn = g('zinsOn');
  const D = { portfolios: [{ uuid: 'A', accountUuid: 'kA' }, { uuid: 'B', accountUuid: 'kB' }, { uuid: 'C', accountUuid: 'kA' }],
    accounts: [{ uuid: 'kA' }, { uuid: 'kB' }, { uuid: 'kT' }, { uuid: 'kX' }], interest: [{ account: 'kT', date: '2026-01-31', gross: 5 }] };
  let m = members(D, { depots: ['A', 'C'], bankOf: {} });
  check('banks: each depot own bank, account follows first depot', JSON.stringify(m.map(b => [b.key, b.depots, b.accounts])) === '[["A",["A"],["kA"]],["C",["C"],[]],["kT",[],["kT"]]]', m);
  m = members(D, { depots: ['A', 'C'], bankOf: { C: 'A' } });
  check('banks: grouping', m.length === 2 && JSON.stringify(m[0].depots) === '["A","C"]', m);
  m = members(D, { depots: ['C'], bankOf: { C: 'A' } });
  check('banks: missing target bank -> default', m.length === 2 && m[0].key === 'C' && JSON.stringify(m[0].accounts) === '["kA"]', m);
  check('banks: account of deselected depot excluded', !members(D, { depots: ['A'], bankOf: {} }).some(b => b.accounts.includes('kB')));
  check('zins: default on for depot account, off for loose account', zinsOn(D, { depots: ['A'], zinsen: {} }, 'kA') && !zinsOn(D, { depots: ['A'], zinsen: {} }, 'kT'));
  check('zins: explicit switch wins', !zinsOn(D, { depots: ['A'], zinsen: { kA: false } }, 'kA'));
  const L = g('ledger');
  const ev = (owner, kind, amount, year = 2026) => ({ year, date: `${year}-05-01`, owner, kind, amount });
  const dat = { portfolios: [{ uuid: 'A', name: 'Depot A', accountUuid: 'kA' }, { uuid: 'B', name: 'Depot B', accountUuid: 'kB' }], accounts: [{ uuid: 'kA', name: 'kA' }, { uuid: 'kB', name: 'kB' }], interest: [] };
  const base = { veranlagung: 'single', kirchensteuer: false, bundesland: 'default', depots: ['A'], bankOf: {}, fsa: {}, genutzt: {}, vortrag: {}, zinsen: {}, fundTypes: {} };
  const R = income => ({ income, lots: [], vpForecast: [] });
  let l = L(R([ev('A', 'sonst', 500)]), dat, base, 2026);
  check('ledger: single bank gets spb automatically', l.banks.length === 1 && l.banks[0].fsa === 1000 && l.banks[0].fsaSource === 'automatisch' && l.banks[0].used === 500 && l.banks[0].fsaLeft === 500, l.banks[0]);
  l = L(R([ev('A', 'sonst', -400, 2024), ev('A', 'div', 300, 2026)]), dat, base, 2026);
  check('ledger: pot carried across years', l.banks[0].vortragComputed.allg === 400 && l.banks[0].used === 0 && l.banks[0].pots.allg === 100, l.banks[0]);
  l = L(R([ev('A', 'sonst', -400, 2017), ev('A', 'div', 300, 2026)]), dat, base, 2026);
  check('ledger: events before 2018 ignored, hint', l.banks[0].vortragComputed.allg === 0 && l.banks[0].used === 300 && l.warnings.some(w => w.includes('2009–2017')), l);
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2026|A': { aktien: 0, allg: 250 } } }, 2026);
  check('ledger: vortrag override', l.banks[0].vortragOverridden && l.banks[0].used === 50, l.banks[0]);
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, genutzt: { '2026|A': 1500 } }, 2026);
  check('ledger: genutzt override capped to fsa', l.banks[0].usedOverridden && l.banks[0].used === 1000 && l.banks[0].fsaLeft === 0, l.banks[0]);
  // Final review M2: Override ≥ FSA hält die Bemessungsgrundlage über dem FSA (Steuer jenseits des FSA bleibt erstattbar)
  l = L(R([ev('A', 'sonst', 3000)]), dat, { ...base, genutzt: { '2026|A': 1000 } }, 2026);
  check('ledger M2: genutzt override = fsa keeps positiveBase above fsa', l.banks[0].used === 1000 && l.banks[0].fsaLeft === 0 && l.banks[0].positiveEff === 3000, l.banks[0]);
  l = L(R([ev('A', 'sonst', 3000)]), dat, { ...base, genutzt: { '2026|A': 400 } }, 2026);
  check('ledger M2: genutzt override below fsa unchanged', l.banks[0].used === 400 && l.banks[0].positiveEff === 400, l.banks[0]);
  const two = { ...base, depots: ['A', 'B'] };
  l = L(R([ev('A', 'sonst', 700), ev('B', 'sonst', 600)]), dat, two, 2026);
  check('ledger: two active banks without FSA -> pooled + warning', l.pooled && l.banks.every(b => b.fsaSource === 'gemeinsam') && l.warnings.some(w => w.includes('Freistellungsaufträge je Bank')), l);
  l = L(R([ev('A', 'sonst', 700), ev('B', 'sonst', 600)]), dat, { ...two, fsa: { A: 600, B: 600 } }, 2026);
  check('ledger: entered FSA per bank, sum warning', !l.pooled && l.banks[0].used === 600 && l.banks[1].used === 600 && l.warnings.some(w => w.includes('übersteigen')), l);
  // Minor 4: gemeinsamer Modus, eingetragene genutzte Beträge zusammen über dem spb -> Hinweis statt stiller Kürzung
  const W4 = 'Eingetragene genutzte Beträge übersteigen den gemeinsamen Sparerpauschbetrag';
  l = L(R([ev('A', 'sonst', 700), ev('B', 'sonst', 600)]), dat, { ...two, genutzt: { '2026|A': 700, '2026|B': 600 } }, 2026);
  check('ledger minor 4: pooled genutzt overrides over spb warn', l.pooled && l.warnings.includes(W4), l.warnings);
  l = L(R([ev('A', 'sonst', 700), ev('B', 'sonst', 600)]), dat, { ...two, genutzt: { '2026|A': 500, '2026|B': 500, '2025|A': 900 } }, 2026);
  check('ledger minor 4: overrides within spb (other years ignored) do not warn', l.pooled && !l.warnings.includes(W4), l.warnings);
  l = L(R([ev('A', 'sonst', 700)]), dat, two, 2026);
  check('ledger: inactive bank does not count', !l.pooled && l.banks.find(b => b.key === 'A').fsa === 1000 && !l.banks.find(b => b.key === 'B').active, l.banks);
  l = L(R([ev('A', 'sonst', 300)]), dat, { ...base, fsa: { A: 400 } }, 2026);
  check('ledger: entered FSA wins with one bank', l.banks[0].fsa === 400 && l.banks[0].fsaSource === 'eingetragen', l.banks[0]);
  // Regression 0.3: eine Bank, keine Zinsen -> used = bisherige Vorbelegung (VP Vorjahr + Ausschüttungen + Verkäufe, gekappt)
  l = L(R([ev('A', 'vp', 120), ev('A', 'div', 92.4), ev('A', 'sonst', 100)]), dat, base, 2026);
  check('ledger: 0.3 prefill regression', l.banks[0].used === 312.4, l.banks[0]);
  l = L({ income: [ev('A', 'aktie', -300, 2025)], lots: [], vpForecast: [] }, dat, base, 2026);
  check('ledger: closed bank with pot stays active and is marked', l.banks[0].active && l.banks[0].closedWithPot && l.banks[0].pots.aktien === 300, l.banks[0]);
  // Minor 2: der Ledger liefert die FSA-Konfiguration, mit der er rechnet (eine Quelle für den Verkaufsplan)
  l = L(R([ev('A', 'sonst', 700), ev('B', 'sonst', 600)]), dat, two, 2026);
  check('ledger minor 2: result carries its fsa config', l.fsa && l.fsa.pooled === l.pooled && l.fsa.spb === l.spb
    && JSON.stringify(l.fsa.byBank) === JSON.stringify(Object.fromEntries(l.banks.map(b => [b.key, b.fsa]))), l.fsa);
  const N = g('ledgerNextYear');
  let n = N({ income: [ev('A', 'sonst', -100)], lots: [{ depot: 'A' }], vpForecast: [{ depot: 'A', taxable: 1200 }] }, dat, base, 2026);
  check('ledgerNextYear: vp against pot then FSA', n.year === 2027 && n.used === 1000 && n.remaining === 0 && n.banks[0].fsaLeft === 0 && near(n.taxAfter, 100 * g('taxRate')(base, 2027)), n);
  n = N({ income: [], lots: [{ depot: 'A' }, { depot: 'B' }], vpForecast: [{ depot: 'A', taxable: 300 }, { depot: 'B', taxable: 200 }] }, dat, two, 2026);
  check('ledgerNextYear: pooled over both banks', n.total === 1000 && n.used === 500 && n.remaining === 500 && n.banks.every(b => b.fsaLeft === 500) && n.taxAfter === 0 && n.pooled === true, n);
  // Minor 3: eingetragene FSA über dem spb – Gesamt und Rest höchstens bis zum Sparerpauschbetrag
  n = N({ income: [], lots: [{ depot: 'A' }, { depot: 'B' }], vpForecast: [{ depot: 'A', taxable: 300 }, { depot: 'B', taxable: 200 }] }, dat, { ...two, fsa: { A: 600, B: 600 } }, 2026);
  check('ledgerNextYear minor 3: total and remaining capped at spb', n.total === 1000 && n.used === 500 && n.remaining === 500, n);
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2025|A': { aktien: 0, allg: 500 } } }, 2026);
  check('ledger: earlier-year vortrag override is carried forward', l.banks[0].vortragComputed.allg === 500 && l.banks[0].used === 0 && l.banks[0].pots.allg === 200 && !l.banks[0].vortragOverridden, l.banks[0]);
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2025|A': { aktien: 0, allg: 500 }, '2026|A': { aktien: 0, allg: 100 } } }, 2026);
  check('ledger: current-year vortrag override wins over earlier one', l.banks[0].vortragComputed.allg === 500 && l.banks[0].vortrag.allg === 100 && l.banks[0].vortragOverridden && l.banks[0].used === 200, l.banks[0]);
  // Final review M6: kein Hinweis auf 2009–2017, sobald die Bank einen Vortrag (bis zum laufenden Jahr) eingetragen hat
  l = L(R([ev('A', 'sonst', -400, 2017), ev('A', 'div', 300, 2026)]), dat, { ...base, vortrag: { '2026|A': { aktien: null, allg: 400 } } }, 2026);
  check('ledger M6: pre-2018 hint suppressed by current-year vortrag', !l.warnings.some(w => w.includes('2009–2017')), l.warnings);
  l = L(R([ev('A', 'sonst', -400, 2017), ev('A', 'div', 300, 2026)]), dat, { ...base, vortrag: { '2019|A': { aktien: 0, allg: null } } }, 2026);
  check('ledger M6: pre-2018 hint suppressed by earlier-year vortrag', !l.warnings.some(w => w.includes('2009–2017')), l.warnings);
  l = L(R([ev('A', 'sonst', -400, 2017), ev('A', 'div', 300, 2026)]), dat, { ...base, vortrag: { '2027|A': { aktien: 0, allg: 5 }, '2026|B': { aktien: 0, allg: 5 } } }, 2026);
  check('ledger M6: later-year or other-bank vortrag keeps the hint', l.warnings.some(w => w.includes('2009–2017')), l.warnings);
  // Final review I1: nur eingetippte Felder überschreiben, das andere bleibt berechnet
  l = L(R([ev('A', 'aktie', -200, 2025), ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2026|A': { aktien: null, allg: 250 } } }, 2026);
  check('ledger I1: only allg typed -> aktien stays computed', l.banks[0].vortragComputed.aktien === 200 && l.banks[0].potsStart.aktien === 200
    && l.banks[0].potsStart.allg === 250 && l.banks[0].vortragOverridden && l.banks[0].used === 50, l.banks[0]);
  l = L(R([ev('A', 'aktie', -200, 2024), ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2025|A': { aktien: null, allg: 500 } } }, 2026);
  check('ledger I1: earlier-year override merges per field', l.banks[0].vortragComputed.aktien === 200 && l.banks[0].vortragComputed.allg === 500 && l.banks[0].used === 0, l.banks[0]);
  l = L(R([ev('A', 'aktie', -200, 2025), ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2026|A': { aktien: null, allg: null } } }, 2026);
  check('ledger I1: entry without typed field is no override', !l.banks[0].vortragOverridden && l.banks[0].potsStart.aktien === 200 && l.banks[0].used === 300, l.banks[0]);
  // Minor 5: negativ eingetippter Vortrag zählt als 0
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2026|A': { aktien: -50, allg: -250 } } }, 2026);
  check('ledger minor 5: negative vortrag override clamped to 0', l.banks[0].potsStart.aktien === 0 && l.banks[0].potsStart.allg === 0 && l.banks[0].used === 300, l.banks[0]);
  l = L(R([ev('A', 'div', 300)]), dat, { ...base, vortrag: { '2025|A': { aktien: null, allg: -500 } } }, 2026);
  check('ledger minor 5: negative earlier-year override clamped to 0', l.banks[0].vortragComputed.allg === 0 && l.banks[0].used === 300, l.banks[0]);
};
