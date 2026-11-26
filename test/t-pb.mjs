import { pbEncode, encodeClient } from './pbwriter.mjs';
export default ({ g, check }) => {
  const read = g('pbRead'), dec = g('decodeClient');
  check('pb: multi-byte varint', read(pbEncode([[1, 0, 300]]))[0].v === 300);
  check('pb: negative int64', read(pbEncode([[11, 0, -12345]]))[0].v === -12345);
  check('pb: unknown fields skipped', dec(encodeClient({ securities: [], extra99: true })).securities.length === 0);
  const c = dec(encodeClient({ version: 66, baseCurrency: 'EUR',
    securities: [{ uuid: 's1', name: 'ETF', currencyCode: 'EUR', isin: 'IE00X', prices: [[19000, 12345000000]] }],
    accounts: [{ uuid: 'a1', name: 'Konto', currencyCode: 'EUR' }], portfolios: [{ uuid: 'p1', name: 'Depot', referenceAccount: 'a1' }],
    transactions: [{ type: 0, uuid: 't1', account: 'a1', portfolio: 'p1', otherUuid: 't1a', seconds: 1700000000, currencyCode: 'EUR', amount: 100000, shares: 1000000000, security: 's1',
      units: [{ type: 2, amount: 100, currencyCode: 'EUR' }] }] }));
  check('pb: client decoded', c.version === 66 && c.securities[0].isin === 'IE00X' && c.securities[0].prices[0][1] === 12345000000
    && c.portfolios[0].referenceAccount === 'a1' && c.transactions[0].type === 0 && c.transactions[0].units[0].type === 2, c);
  const t0 = performance.now(); dec(encodeClient({ securities: Array.from({ length: 50 }, (_, i) => ({ uuid: 's' + i, name: 'S', currencyCode: 'EUR', prices: Array.from({ length: 3000 }, (_, d) => [17000 + d, 1e10]) })) }));
  check('pb: 150k prices decode < 3 s', performance.now() - t0 < 3000);
};
