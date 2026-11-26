import { pbkdf2Sync, createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeZip } from './zipwriter.mjs';
import { encodeClient } from './pbwriter.mjs';
import { toIdMode } from './t-pp.mjs';

// Salt aus ClientFactory.java (signed Java bytes)
const SALT = Buffer.from(Int8Array.from([112, 67, 103, 107, -92, -125, -112, -95, -97, -114, 117, -56, -53, -69, -25, -28]).buffer);
const te = new TextEncoder();
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const u32be = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };

export default async ({ g, check, root, ctx }) => {
  const load = g('loadPortfolioData'), readPortfolioFile = g('readPortfolioFile'), decryptPortfolio = g('decryptPortfolio'), unzipFirst = g('unzipFirst');
  const code = p => p.then(() => 'OK', e => e.message);

  const xml = '<client><securities/><accounts/><portfolios><portfolio><uuid>pf-1</uuid><name>Depot</name><transactions/></portfolio></portfolios></client>';
  const pb = encodeClient({ securities: [{ uuid: 'sec-1', name: 'ETF', currencyCode: 'EUR' }], portfolios: [{ uuid: 'pf-1', name: 'Depot' }] });
  const pbWithSig = concat(te.encode('PPPBV1'), pb);
  const idModeXml = toIdMode(g, readFileSync(join(root, 'test/fixtures/xpath.xml'), 'utf8'));

  // Verschlüsselte Datei wie ClientFactory: PORTFOLIO · Methode · IV · AES-CBC([Inhaltstyp][Version][ZIP mit Eintrag „data“])
  async function encFile({ method, contentType, version = 66, pw, xml: x = xml, payload }) {
    const content = payload || (contentType === 1 ? te.encode(x) : pbWithSig);
    const zip = new Uint8Array(await makeZip([['data', content]], { javaStyle: true }));
    const plain = concat(u32be(contentType), u32be(version), zip);
    const key = pbkdf2Sync(pw, SALT, 65536, method === 1 ? 32 : 16, 'sha1'), iv = randomBytes(16);
    const c = createCipheriv(method === 1 ? 'aes-256-cbc' : 'aes-128-cbc', key, iv);
    const cipher = Buffer.concat([c.update(plain), c.final()]);
    return concat(te.encode('PORTFOLIO'), Uint8Array.of(method), iv, cipher).buffer;
  }
  const zipFile = async (name, content, opts) => makeZip([['meta.txt', 'x'], [name, content]], opts);

  check('crypto: aes256 + protobuf', (await load(await encFile({ method: 1, contentType: 2, pw: 'geheim' }), 'geheim')).securities.length === 1);
  check('crypto: aes128 + xml', (await load(await encFile({ method: 0, contentType: 1, pw: 'geheim' }), 'geheim')).portfolios.length === 1);
  check('crypto: xml id-reference mode', (await load(await encFile({ method: 1, contentType: 1, xml: idModeXml, pw: 'p' }), 'p')).txs.length > 0);
  check('crypto: password as UTF-8', (await load(await encFile({ method: 1, contentType: 2, pw: 'pässwört€' }), 'pässwört€')).securities.length === 1);
  check('crypto: no password → NEEDS_PASSWORD', await code(load(await encFile({ method: 1, contentType: 2, pw: 'x' }))) === 'NEEDS_PASSWORD');
  for (const wrong of ['', 'falsch', 'Geheim', 'geheim ']) {
    const got = await code(load(await encFile({ method: 1, contentType: 2, pw: 'geheim' }), wrong));
    check('crypto: wrong password ' + JSON.stringify(wrong), got === 'WRONG_PASSWORD', got);
  }
  check('crypto: wrong password aes128', await code(load(await encFile({ method: 0, contentType: 1, pw: 'geheim' }), 'falsch')) === 'WRONG_PASSWORD');
  check('crypto: version 201 → WRONG_PASSWORD', await code(load(await encFile({ method: 1, contentType: 2, version: 201, pw: 'p' }), 'p')) === 'WRONG_PASSWORD');
  check('crypto: version 0 → WRONG_PASSWORD', await code(load(await encFile({ method: 1, contentType: 2, version: 0, pw: 'p' }), 'p')) === 'WRONG_PASSWORD');
  check('crypto: version 200 accepted', (await load(await encFile({ method: 1, contentType: 2, version: 200, pw: 'p' }), 'p')).securities.length === 1);
  check('crypto: content type 3 → WRONG_PASSWORD', await code(load(await encFile({ method: 1, contentType: 3, payload: pbWithSig, pw: 'p' }), 'p')) === 'WRONG_PASSWORD');
  check('crypto: protobuf without PPPBV1 → UNSUPPORTED_FORMAT', await code(load(await encFile({ method: 1, contentType: 2, payload: pb, pw: 'p' }), 'p')) === 'UNSUPPORTED_FORMAT');
  check('crypto: truncated header → UNSUPPORTED_FORMAT', await code(load(te.encode('PORTFOLIO\x01').buffer, 'p')) === 'UNSUPPORTED_FORMAT');
  const unknownMethod = new Uint8Array(await encFile({ method: 1, contentType: 2, pw: 'p' })); unknownMethod[9] = 2;
  check('crypto: unknown method → UNSUPPORTED_FORMAT', await code(load(unknownMethod.buffer, 'p')) === 'UNSUPPORTED_FORMAT');

  const dec = await decryptPortfolio(new Uint8Array(await encFile({ method: 0, contentType: 2, version: 59, pw: 'p' })), 'p');
  check('crypto: decryptPortfolio header + inner zip', dec.contentType === 2 && dec.version === 59 && dec.inner[0] === 0x50 && dec.inner[1] === 0x4b, dec);

  // Leeres Passwort: WRONG_PASSWORD ohne Schlüsselableitung
  const realCrypto = ctx.crypto; let imported = false;
  ctx.crypto = { subtle: { importKey: () => { imported = true; throw new Error('importKey called'); } } };
  try {
    const got = await code(load(await encFile({ method: 1, contentType: 2, pw: 'p' }), ''));
    check('crypto: empty password → WRONG_PASSWORD without importKey', got === 'WRONG_PASSWORD' && !imported, { got, imported });
  } finally { ctx.crypto = realCrypto; }

  // Unverschlüsseltes ZIP: Dispatch nach Eintragsname
  check('zip: data.portfolio binary', (await load(await zipFile('data.portfolio', pbWithSig))).securities.length === 1);
  check('zip: data.portfolio binary java-style', (await load(await zipFile('data.portfolio', pbWithSig, { javaStyle: true }))).securities.length === 1);
  check('zip: data.xml', (await load(await zipFile('data.xml', xml, { javaStyle: true }))).portfolios.length === 1);
  check('zip: data.portfolio without PPPBV1 → UNSUPPORTED_FORMAT', await code(load(await zipFile('data.portfolio', new Uint8Array([1, 2, 3])))) === 'UNSUPPORTED_FORMAT');
  check('zip: password ignored for unencrypted', (await load(await zipFile('data.portfolio', pbWithSig), 'egal')).securities.length === 1);
  const rb = await readPortfolioFile(await zipFile('data.portfolio', pbWithSig));
  check('zip: protobuf bytes without signature', rb.kind === 'protobuf' && rb.bytes.length === pb.length && rb.bytes.every((b, i) => b === pb[i]), rb);
  check('file: plain xml via load', (await load(te.encode(xml).buffer)).portfolios.length === 1);

  // unzipFirst
  const zz = new Uint8Array(await makeZip([['a.txt', 'A'], ['b.bin', Uint8Array.of(0, 255, 7)]], { javaStyle: true }));
  const first = await unzipFirst(zz);
  check('unzipFirst: first entry', first.name === 'a.txt' && new TextDecoder().decode(first.bytes) === 'A', first);
  const bin = await unzipFirst(zz, n => n.endsWith('.bin'));
  check('unzipFirst: name filter, binary content', bin.name === 'b.bin' && bin.bytes.join() === '0,255,7', bin);
  check('unzipFirst: no match → UNSUPPORTED_FORMAT', await code(unzipFirst(zz, n => n === 'x')) === 'UNSUPPORTED_FORMAT');
};
