import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Wandelt eine XPath-referenzierte PP-Datei in den XStream-id-Modus um (für den Gleichheitstest).
function toIdMode(g, xml) {
  const root = g('parseXml')(xml), deref = g('deref');
  const ids = new Map(); let n = 0;
  const assign = node => { if (node.attrs.reference === undefined) { ids.set(node, String(++n)); node.children.forEach(assign); } };
  assign(root);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const out = node => {
    if (node.attrs.reference !== undefined) {
      const rest = Object.entries(node.attrs).filter(([k]) => k !== 'reference').map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
      return `<${node.name}${rest} reference="${ids.get(deref(node))}"/>`;
    }
    const attrs = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${node.name} id="${ids.get(node)}"${attrs}>${node.children.length ? node.children.map(out).join('') : esc(node.text)}</${node.name}>`;
  };
  return out(root);
}
const plain = d => JSON.parse(JSON.stringify({ ...d, prices: [...d.prices.entries()] }));

export default ({ g, check, near, root }) => {
  const extract = g('extractPortfolio');
  const fx = f => readFileSync(join(root, 'test/fixtures', f), 'utf8');

  const d = extract(fx('xpath.xml'));
  check('pp: one EUR security kept', d.securities.length === 1 && d.securities[0].uuid === 'sec-etf', d.securities);
  check('pp: security fields', d.securities[0].name === 'World ETF & Co' && d.securities[0].isin === 'IE00TEST0001' && d.securities[0].wkn === 'A0TEST');
  check('pp: non-EUR warning', d.warnings.includes('Nicht in EUR, ignoriert: US Stock'), d.warnings);
  check('pp: portfolio with account', d.portfolios.length === 1 && d.portfolios[0].uuid === 'pf-1' && d.portfolios[0].name === 'Depot A' && d.portfolios[0].accountUuid === 'acc-1', d.portfolios);
  check('pp: 3 EUR txs', d.txs.length === 3, d.txs.map(t => t.uuid));
  const byId = Object.fromEntries(d.txs.map(t => [t.uuid, t]));
  const b = byId['pt-buy1'];
  check('pp: buy decoded', b && b.type === 'BUY' && b.date === '2022-03-15' && b.depot === 'pf-1' && b.security === 'sec-etf'
    && b.shares === 10 && near(b.amount, 1005) && near(b.fees, 5) && b.taxes === 0, b);
  const s = byId['pt-sell1'];
  check('pp: sell decoded', s && s.type === 'SELL' && s.date === '2023-06-01' && s.shares === 2 && near(s.amount, 239) && near(s.fees, 1), s);
  check('pp: delivery inbound', byId['pt-del1'] && byId['pt-del1'].type === 'DELIVERY_INBOUND' && near(byId['pt-del1'].amount, 550));
  check('pp: dividend gross = net + tax', d.dividends.length === 1 && d.dividends[0].date === '2023-07-10' && d.dividends[0].depots.join() === 'pf-1'
    && d.dividends[0].security === 'sec-etf' && near(d.dividends[0].gross, 12.64), d.dividends);
  const pr = d.prices.get('sec-etf');
  check('pp: prices sorted and scaled', pr.length === 3 && pr[0][0] === '2022-12-30' && near(pr[0][1], 100) && near(pr[2][1], 130), pr);

  // id-Modus liefert dasselbe Ergebnis
  const idXml = toIdMode(g, fx('xpath.xml'));
  check('pp: id-mode fixture really uses ids', /^<client id="1">/.test(idXml) && /reference="\d+"/.test(idXml));
  check('pp: id-mode == xpath-mode', JSON.stringify(plain(extract(idXml))) === JSON.stringify(plain(d)));

  // Depotübertrag
  const t = extract(fx('transfer.xml'));
  check('pp: two depots', t.portfolios.map(p => p.uuid).join() === 'pf-A,pf-B' && t.portfolios[1].accountUuid === 'acc-1', t.portfolios);
  const out = t.txs.find(x => x.type === 'TRANSFER_OUT'), inn = t.txs.find(x => x.type === 'TRANSFER_IN');
  check('pp: transfer pair', out && inn && out.depot === 'pf-A' && inn.depot === 'pf-B' && out.transferKey === 'pt-out' && inn.transferKey === 'pt-out' && inn.shares === 4, { out, inn });

  // Laufzeit: 100.000 Kurse
  const prices = Array.from({ length: 100000 }, (_, k) => `<price t="${new Date(Date.UTC(1990, 0, 1) + k * 864e5).toISOString().slice(0, 10)}" v="${1e10 + k}"/>`).join('\n');
  const big = fx('xpath.xml').replace('<price t="2023-12-29" v="12000000000"/>', prices);
  const t0 = performance.now(); const bd = extract(big); const ms = performance.now() - t0;
  check('perf: 100k prices < 2000 ms', ms < 2000 && bd.prices.get('sec-etf').length === 100002, Math.round(ms));
  const ZX = `<client><securities/><accounts>
    <account><uuid>acc-1</uuid><name>Verrechnung</name><currencyCode>EUR</currencyCode><transactions>
      <account-transaction><uuid>z1</uuid><date>2026-03-31T00:00</date><amount>7500</amount><type>INTEREST</type>
        <units><unit type="TAX"><amount amount="2638"/></unit></units></account-transaction>
      <account-transaction><uuid>z2</uuid><date>2026-04-30T00:00</date><amount>1200</amount><type>INTEREST_CHARGE</type></account-transaction>
    </transactions></account>
    <account><uuid>acc-2</uuid><name>USD-Konto</name><currencyCode>USD</currencyCode><transactions>
      <account-transaction><uuid>z3</uuid><date>2026-03-31T00:00</date><amount>500</amount><type>INTEREST</type></account-transaction>
    </transactions></account></accounts>
    <portfolios><portfolio><uuid>pf-1</uuid><name>Depot</name><referenceAccount><uuid>acc-1</uuid></referenceAccount><transactions/></portfolio></portfolios></client>`;
  const zd = extract(ZX);
  check('pp: accounts listed', zd.accounts.length === 2 && zd.accounts[0].uuid === 'acc-1' && zd.accounts[1].currency === 'USD', zd.accounts);
  check('pp: interest gross = net + tax', zd.interest.length === 1 && zd.interest[0].account === 'acc-1' && near(zd.interest[0].gross, 101.38) && zd.interest[0].date === '2026-03-31', zd.interest);
  check('pp: INTEREST_CHARGE ignored', !zd.interest.some(i => i.uuid === 'z2'));
  check('pp: non-EUR interest warned', zd.warnings.some(w => w.includes('Zinsen in USD ignoriert') && w.includes('USD-Konto')), zd.warnings);
  // Minor 11: negative INTEREST (Negativzins) übersprungen; dieselbe UUID zählt einmal
  const ZN = `<client><securities/><accounts>
    <account><uuid>acc-1</uuid><name>Verrechnung</name><currencyCode>EUR</currencyCode><transactions>
      <account-transaction><uuid>n1</uuid><date>2026-01-31T00:00</date><amount>-500</amount><type>INTEREST</type></account-transaction>
      <account-transaction><uuid>d1</uuid><date>2026-02-28T00:00</date><amount>1000</amount><type>INTEREST</type></account-transaction>
      <account-transaction><uuid>d1</uuid><date>2026-02-28T00:00</date><amount>1000</amount><type>INTEREST</type></account-transaction>
    </transactions></account></accounts>
    <portfolios><portfolio><uuid>pf-1</uuid><name>Depot</name><referenceAccount><uuid>acc-1</uuid></referenceAccount><transactions/></portfolio></portfolios></client>`;
  const zn = extract(ZN);
  check('pp minor 11: negative INTEREST skipped', !zn.interest.some(i => i.uuid === 'n1' || i.gross < 0), zn.interest);
  check('pp minor 11: interest deduped per UUID', zn.interest.length === 1 && zn.interest[0].uuid === 'd1' && near(zn.interest[0].gross, 10), zn.interest);
};
