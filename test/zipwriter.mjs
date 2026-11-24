// Minimaler ZIP-Schreiber nur für Tests. javaStyle: Größen im Local Header 0 + Data Descriptor (wie Java ZipOutputStream).
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const deflate = async b => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());

export async function makeZip(entries, { javaStyle = false } = {}) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of entries) {
    const raw = new TextEncoder().encode(text), comp = await deflate(raw), nm = new TextEncoder().encode(name), crc = crc32(raw);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, javaStyle ? 8 : 0, true); lh.setUint16(8, 8, true);
    if (!javaStyle) { lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, raw.length, true); }
    lh.setUint16(26, nm.length, true);
    const dd = new DataView(new ArrayBuffer(javaStyle ? 16 : 0));
    if (javaStyle) { dd.setUint32(0, 0x08074b50, true); dd.setUint32(4, crc, true); dd.setUint32(8, comp.length, true); dd.setUint32(12, raw.length, true); }
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, javaStyle ? 8 : 0, true); ch.setUint16(10, 8, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), nm, comp, new Uint8Array(dd.buffer));
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + comp.length + dd.byteLength;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, entries.length, true); eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)]).arrayBuffer();
}
