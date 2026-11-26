// Test-Encoder für Protobuf (Spiegel von decodeClient) – nur für Tests, nicht Teil der Engine.
const te = new TextEncoder();
function varint(n) {
  let b = BigInt(n);
  if (b < 0n) b = BigInt.asUintN(64, b);
  const out = [];
  while (b >= 0x80n) { out.push(Number(b & 0x7fn) | 0x80); b >>= 7n; }
  out.push(Number(b));
  return out;
}
// fields: [fieldNumber, wireType, value]; wire 0 = Zahl, 2 = Uint8Array|string, 1/5 = Füllbytes
export function pbEncode(fields) {
  const parts = [];
  for (const [f, w, v] of fields) {
    parts.push(...varint(f * 8 + w));
    if (w === 0) parts.push(...varint(v));
    else if (w === 2) { const b = typeof v === 'string' ? te.encode(v) : v; parts.push(...varint(b.length)); for (const x of b) parts.push(x); }
    else if (w === 1) parts.push(0, 0, 0, 0, 0, 0, 0, 0);
    else if (w === 5) parts.push(0, 0, 0, 0);
  }
  return Uint8Array.from(parts);
}
const S = (f, v) => v ? [[f, 2, v]] : [];
const N = (f, v) => v ? [[f, 0, v]] : [];
export function encodeClient(o) {
  const fs = [];
  fs.push(...N(1, o.version));
  for (const s of o.securities || []) {
    const e = [...S(1, s.uuid), ...S(3, s.name), ...S(4, s.currencyCode), ...S(7, s.isin), ...S(8, s.ticker), ...S(9, s.wkn)];
    for (const [d, c] of s.prices || []) e.push([13, 2, pbEncode([...N(1, d), ...N(2, c)])]);
    e.push(...N(20, s.retired ? 1 : 0));
    fs.push([2, 2, pbEncode(e)]);
  }
  for (const a of o.accounts || []) fs.push([3, 2, pbEncode([...S(1, a.uuid), ...S(2, a.name), ...S(3, a.currencyCode)])]);
  for (const p of o.portfolios || []) fs.push([4, 2, pbEncode([...S(1, p.uuid), ...S(2, p.name), ...S(5, p.referenceAccount)])]);
  for (const t of o.transactions || []) {
    const e = [...S(1, t.uuid), ...N(2, t.type), ...S(3, t.account), ...S(4, t.portfolio), ...S(5, t.otherAccount), ...S(6, t.otherPortfolio), ...S(7, t.otherUuid)];
    if (t.seconds !== undefined) e.push([9, 2, pbEncode([...N(1, t.seconds)])]);
    e.push(...S(10, t.currencyCode), ...N(11, t.amount), ...N(12, t.shares), ...S(14, t.security));
    for (const u of t.units || []) e.push([15, 2, pbEncode([...N(1, u.type), ...N(2, u.amount), ...S(3, u.currencyCode)])]);
    fs.push([5, 2, pbEncode(e)]);
  }
  fs.push(...S(12, o.baseCurrency));
  if (o.extra99) fs.push([99, 0, 7], [98, 1, 0], [97, 5, 0], [96, 2, 'x']);
  return pbEncode(fs);
}
