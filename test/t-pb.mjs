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
  check('pb: client decoded', c.securities[0].isin === 'IE00X' && c.securities[0].prices[0][1] === 12345000000
    && c.portfolios[0].referenceAccount === 'a1' && c.transactions[0].type === 0 && c.transactions[0].units[0].type === 2, c);
  const t0 = performance.now(); dec(encodeClient({ securities: Array.from({ length: 50 }, (_, i) => ({ uuid: 's' + i, name: 'S', currencyCode: 'EUR', prices: Array.from({ length: 3000 }, (_, d) => [17000 + d, 1e10]) })) }));
  check('pb: 150k prices decode < 3 s', performance.now() - t0 < 3000);
  const throws = f => { try { f(); return false; } catch { return true; } };
  check('pb: negative length varint throws', throws(() => read(Uint8Array.from([0x12, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 1, 2, 3]))));
  check('pb: truncated length-delimited throws', throws(() => read(Uint8Array.from([0x12, 5, 1, 2]))));
  const longVarint = new Uint8Array(1002); longVarint[0] = 0x08; longVarint.fill(0x80, 1, 1001); longVarint[1001] = 0x01;
  const t1 = performance.now(), longThrows = throws(() => read(longVarint));
  check('pb: varint longer than 10 bytes throws quickly', longThrows && performance.now() - t1 < 100, { longThrows, ms: performance.now() - t1 });
  check('pb: 10-byte varint still read', read(pbEncode([[1, 0, -1]]))[0].v === -1);
  check('pb: truncated varint throws', throws(() => read(Uint8Array.from([0x08, 0x80]))));
  const r = dec(encodeClient({ securities: [{ uuid: 's', wkn: 'WKN123', ticker: 'TCK', retired: true }, { uuid: 's2' }],
    accounts: [{ uuid: 'a' }], portfolios: [{ uuid: 'p' }],
    transactions: [{ type: 8, uuid: 't', otherAccount: 'oa', otherPortfolio: 'op', seconds: -86400 }] }));
  check('pb: unused fields are not decoded', !('wkn' in r.securities[0]) && !('ticker' in r.securities[0]) && !('retired' in r.securities[0]) && !('otherAccount' in r.transactions[0]) && !('version' in r) && !('baseCurrency' in r), [r.securities[0], r.transactions[0]]);
  check('pb: absent fields default', r.securities[1].isin === '' && r.securities[1].prices.length === 0
    && r.transactions[0].shares === 0 && r.transactions[0].security === '' && r.accounts[0].currencyCode === '' && r.portfolios[0].referenceAccount === '', r);
  check('pb: otherPortfolio/negative seconds', r.transactions[0].otherPortfolio === 'op' && r.transactions[0].seconds === -86400 && r.transactions[0].type === 8, r.transactions[0]);
};
