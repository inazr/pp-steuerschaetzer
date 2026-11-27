// Minimaler Protobuf-Leser für Portfolio-Performance-Dateien (nur die benötigten Felder).
// Wire-Types: 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32 (fixed-Werte werden übersprungen).
function pbRead(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  const varint = () => {
    const start = i;
    while (i < n && bytes[i] & 0x80 && i - start < 10) i++;
    if (i >= n) throw new Error('Protobuf: abgeschnittener Varint');
    const len = i - start + 1;
    if (len > 10) throw new Error('Protobuf: Varint zu lang'); // höchstens 10 Bytes (64 Bit)
    i++;
    if (len <= 7) {
      let v = 0, mul = 1;
      for (let k = start; k < start + len; k++) { v += (bytes[k] & 0x7f) * mul; mul *= 128; }
      return v;
    }
    let b = 0n;
    for (let k = start + len - 1; k >= start; k--) b = (b << 7n) | BigInt(bytes[k] & 0x7f);
    return Number(BigInt.asIntN(64, b));
  };
  while (i < n) {
    const key = varint();
    const f = Math.floor(key / 8), w = key % 8;
    if (w === 0) out.push({ f, w, v: varint() });
    else if (w === 2) {
      const len = varint();
      if (len < 0 || i + len > n) throw new Error('Protobuf: ungültige Feldlänge');
      out.push({ f, w, v: bytes.subarray(i, i + len) });
      i += len;
    } else if (w === 1) i += 8;
    else if (w === 5) i += 4;
    else throw new Error('Protobuf: unbekannter Wire-Type ' + w);
    if (i > n) throw new Error('Protobuf: abgeschnittenes Feld');
  }
  return out;
}

function decodeClient(bytes) {
  const td = new TextDecoder();
  const str = v => td.decode(v);
  const c = { securities: [], accounts: [], portfolios: [], transactions: [] };
  for (const { f, w, v } of pbRead(bytes)) {
    if (w !== 2) continue;
    else if (f === 2) {
      const s = { uuid: '', name: '', currencyCode: '', isin: '', prices: [] };
      for (const e of pbRead(v)) {
        if (e.f === 1 && e.w === 2) s.uuid = str(e.v);
        else if (e.f === 3 && e.w === 2) s.name = str(e.v);
        else if (e.f === 4 && e.w === 2) s.currencyCode = str(e.v);
        else if (e.f === 7 && e.w === 2) s.isin = str(e.v);
        else if (e.f === 13 && e.w === 2) {
          let day = 0, close = 0;
          for (const p of pbRead(e.v)) { if (p.f === 1 && p.w === 0) day = p.v; else if (p.f === 2 && p.w === 0) close = p.v; }
          s.prices.push([day, close]);
        }
      }
      c.securities.push(s);
    } else if (f === 3) {
      const a = { uuid: '', name: '', currencyCode: '' };
      for (const e of pbRead(v)) {
        if (e.w !== 2) continue;
        if (e.f === 1) a.uuid = str(e.v); else if (e.f === 2) a.name = str(e.v); else if (e.f === 3) a.currencyCode = str(e.v);
      }
      c.accounts.push(a);
    } else if (f === 4) {
      const p = { uuid: '', name: '', referenceAccount: '' };
      for (const e of pbRead(v)) {
        if (e.w !== 2) continue;
        if (e.f === 1) p.uuid = str(e.v); else if (e.f === 2) p.name = str(e.v); else if (e.f === 5) p.referenceAccount = str(e.v);
      }
      c.portfolios.push(p);
    } else if (f === 5) {
      const t = { type: 0, uuid: '', account: '', portfolio: '', otherPortfolio: '', otherUuid: '', seconds: 0,
        currencyCode: '', amount: 0, shares: 0, security: '', units: [] };
      for (const e of pbRead(v)) {
        if (e.w === 0) {
          if (e.f === 2) t.type = e.v; else if (e.f === 11) t.amount = e.v; else if (e.f === 12) t.shares = e.v;
        } else if (e.w === 2) {
          if (e.f === 1) t.uuid = str(e.v);
          else if (e.f === 3) t.account = str(e.v);
          else if (e.f === 4) t.portfolio = str(e.v);
          else if (e.f === 6) t.otherPortfolio = str(e.v);
          else if (e.f === 7) t.otherUuid = str(e.v);
          else if (e.f === 10) t.currencyCode = str(e.v);
          else if (e.f === 14) t.security = str(e.v);
          else if (e.f === 9) { for (const d of pbRead(e.v)) if (d.f === 1 && d.w === 0) t.seconds = d.v; }
          else if (e.f === 15) {
            const u = { type: 0, amount: 0 };
            for (const x of pbRead(e.v)) {
              if (x.f === 1 && x.w === 0) u.type = x.v; else if (x.f === 2 && x.w === 0) u.amount = x.v;
            }
            t.units.push(u);
          }
        }
      }
      c.transactions.push(t);
    }
  }
  return c;
}
