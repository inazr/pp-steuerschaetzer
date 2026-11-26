// Liest eine PP-Datei. Erkennung an den ersten Bytes: PORTFOLIO → verschlüsselt, PK\3\4 → ZIP, sonst XML-Text.
// Ergebnis: { kind: 'xml', text } | { kind: 'protobuf', bytes } (Protobuf ohne den Vorspann PPPBV1).
// Fehler: UNSUPPORTED_FORMAT (auch: beschädigt), NEEDS_PASSWORD, WRONG_PASSWORD, NO_CRYPTO (kein WebCrypto). Das Passwort wird nirgends gespeichert.
const PP_ENCRYPTED_SIG = 'PORTFOLIO', PP_PROTOBUF_SIG = 'PPPBV1';
const PP_CONTENT_XML = 1, PP_CONTENT_PROTOBUF = 2;

async function readPortfolioFile(buf, password) {
  const u8 = new Uint8Array(buf);
  if (startsWithAscii(u8, PP_ENCRYPTED_SIG)) {
    const { contentType, inner } = await decryptPortfolio(u8, password);
    const { bytes } = await unzipFirst(inner);
    return contentType === PP_CONTENT_XML ? xmlContent(bytes) : protobufContent(bytes);
  }
  if (isZip(u8)) {
    const { name, bytes } = await unzipFirst(u8, n => /\.(xml|portfolio)$/i.test(n));
    return /\.portfolio$/i.test(name) ? protobufContent(bytes) : xmlContent(bytes);
  }
  return xmlContent(u8);
}

const startsWithAscii = (u8, s) => u8.length >= s.length && [...s].every((c, i) => u8[i] === c.charCodeAt(0));
const isZip = u8 => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;

function xmlContent(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes);
  if (!text.trimStart().startsWith('<')) throw new Error('UNSUPPORTED_FORMAT');
  return { kind: 'xml', text };
}

function protobufContent(bytes) {
  if (!startsWithAscii(bytes, PP_PROTOBUF_SIG)) throw new Error('UNSUPPORTED_FORMAT');
  return { kind: 'protobuf', bytes: bytes.subarray(PP_PROTOBUF_SIG.length) };
}

// Verschlüsselt (ClientFactory.java): PORTFOLIO (9) · Methode (1: 0 = AES-128, 1 = AES-256) · IV (16) · AES/CBC/PKCS5.
// Schlüssel: PBKDF2-HMAC-SHA1(Passwort UTF-8, festes Salt, 65536 Iterationen). Klartext: Inhaltstyp (u32be) · Version (u32be) · ZIP.
const PP_SALT = Uint8Array.from([112, 67, 103, 107, -92, -125, -112, -95, -97, -114, 117, -56, -53, -69, -25, -28], b => b & 0xff);
const PP_ITERATIONS = 65536, PP_MAX_VERSION = 200;

async function decryptPortfolio(u8, password) {
  const head = PP_ENCRYPTED_SIG.length, ivStart = head + 1, dataStart = ivStart + 16;
  if (u8.length < dataStart) throw new Error('UNSUPPORTED_FORMAT');
  const keyLength = { 0: 128, 1: 256 }[u8[head]];
  if (!keyLength) throw new Error('UNSUPPORTED_FORMAT');
  const cipherLength = u8.length - dataStart; // AES-CBC: ganze 16-Byte-Blöcke, sonst ist die Datei abgeschnitten
  if (cipherLength === 0 || cipherLength % 16) throw new Error('UNSUPPORTED_FORMAT');
  if (password === undefined || password === null) throw new Error('NEEDS_PASSWORD');
  if (password === '') throw new Error('WRONG_PASSWORD');

  const subtle = globalThis.crypto?.subtle; // fehlt in unsicherem Kontext (http außer localhost)
  if (!subtle) throw new Error('NO_CRYPTO');
  const pwBytes = new TextEncoder().encode(password);
  let base;
  try { base = await subtle.importKey('raw', pwBytes, 'PBKDF2', false, ['deriveKey']); } finally { pwBytes.fill(0); }
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt: PP_SALT, iterations: PP_ITERATIONS, hash: 'SHA-1' },
    base, { name: 'AES-CBC', length: keyLength }, false, ['encrypt', 'decrypt']);
  const iv = u8.slice(ivStart, dataStart), cipher = u8.slice(dataStart);

  // Passwortprüfung nur an Block 0: c0 plus ein Block, der zu reinem Padding entschlüsselt (16 × 0x10) → Padding immer gültig.
  // So bleibt eine abgeschnittene oder beschädigte Datei mit richtigem Passwort „beschädigt“ statt „Passwort falsch“.
  const c0 = cipher.slice(0, 16);
  const pad = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: c0 }, key, new Uint8Array(16).fill(16))).slice(0, 16);
  const p0 = new DataView(await subtle.decrypt({ name: 'AES-CBC', iv }, key, concatBytes(c0, pad)));
  const contentType = p0.getUint32(0), version = p0.getUint32(4);
  if ((contentType !== PP_CONTENT_XML && contentType !== PP_CONTENT_PROTOBUF) || version < 1 || version > PP_MAX_VERSION) throw new Error('WRONG_PASSWORD');

  let plain;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, key, cipher));
  } catch (e) {
    if (e && e.name === 'OperationError') throw new Error('UNSUPPORTED_FORMAT'); // Padding falsch: Datei beschädigt
    throw e;
  }
  if (plain.length < 8) throw new Error('UNSUPPORTED_FORMAT');
  return { contentType, version, inner: plain.subarray(8) };
}

const concatBytes = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

// Erster ZIP-Eintrag (optional: dessen Name nameFilter erfüllt), entpackt. Größen aus dem zentralen Verzeichnis,
// damit auch gestreamt geschriebene ZIPs (Java ZipOutputStream, Data Descriptor) lesbar sind.
async function unzipFirst(u8, nameFilter) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let p = u8.length - 22; p >= Math.max(0, u8.length - 22 - 65535); p--) if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break; }
  if (eocd < 0) throw new Error('UNSUPPORTED_FORMAT');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < count; k++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (nameFilter && !nameFilter(name)) continue;
    if (local + 30 > u8.length) throw new Error('UNSUPPORTED_FORMAT');
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = u8.subarray(start, start + comp);
    if (method === 0) return { name, bytes: data };
    if (method !== 8) throw new Error('UNSUPPORTED_FORMAT');
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return { name, bytes: new Uint8Array(await new Response(stream).arrayBuffer()) };
    } catch { throw new Error('UNSUPPORTED_FORMAT'); } // kaputte Deflate-Daten
  }
  throw new Error('UNSUPPORTED_FORMAT');
}
