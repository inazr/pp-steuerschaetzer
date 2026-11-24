// Liest eine PP-Datei: XML direkt oder .portfolio-ZIP (erster *.xml-Eintrag). Alles andere: UNSUPPORTED_FORMAT.
async function readPortfolioFile(buf) {
  const u8 = new Uint8Array(buf);
  const isZip = u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;
  const text = isZip ? await unzipFirstXml(u8) : new TextDecoder('utf-8').decode(u8);
  if (!text.trimStart().startsWith('<')) throw new Error('UNSUPPORTED_FORMAT');
  return text;
}

async function unzipFirstXml(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let p = u8.length - 22; p >= Math.max(0, u8.length - 22 - 65535); p--) if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('UNSUPPORTED_FORMAT');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (!/\.xml$/i.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + comp);
    if (method === 0) return new TextDecoder('utf-8').decode(data);
    if (method !== 8) throw new Error('UNSUPPORTED_FORMAT');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder('utf-8').decode(await new Response(stream).arrayBuffer());
  }
  throw new Error('UNSUPPORTED_FORMAT');
}
