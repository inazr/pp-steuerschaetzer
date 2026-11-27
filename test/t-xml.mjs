import { makeZip } from './zipwriter.mjs';

export default async ({ g, check }) => {
  const parseXml = g('parseXml'), deref = g('deref'), child = g('child'), kids = g('kids'), readPortfolioFile = g('readPortfolioFile');

  // Grundlagen: Entities, selbstschließende Tags, Attribute, Kommentare, Deklaration
  const r = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><a x="1 &amp; 2"><b>T&amp;M &lt;3 &#228;&#x20AC;</b><c/><d k=\'v\'/><![CDATA[<raw>]]></a>');
  check('xml: root name', r.name === 'a');
  check('xml: attr entity', r.attrs.x === '1 & 2', r.attrs.x);
  check('xml: text entities', child(r, 'b').text === 'T&M <3 ä€', child(r, 'b').text);
  check('xml: self-closing', child(r, 'c') && child(r, 'c').children.length === 0);
  check('xml: single-quoted attr', child(r, 'd').attrs.k === 'v');
  check('xml: parent link', child(r, 'b').parent === r);

  // XStream XPath-Referenzen, relativ zum referenzierenden Element
  const x = parseXml(`<client><securities><security><uuid>s1</uuid></security><security><uuid>s2</uuid></security></securities>
    <accounts><account><tx><security reference="../../../../securities/security[2]"/><other reference="../security"/></tx>
    <tx><security reference="../../../../securities/security"/></tx></account></accounts></client>`);
  const txs = kids(child(child(x, 'accounts'), 'account'), 'tx');
  check('xpath: indexed ref', child(child(txs[0], 'security'), 'uuid').text === 's2');
  check('xpath: unindexed ref = first', child(child(txs[1], 'security'), 'uuid').text === 's1');
  check('xpath: transitive ref', child(child(txs[0], 'other'), 'uuid').text === 's2');
  check('xpath: kids derefs', kids(child(x, 'securities'), 'security').length === 2);

  // XStream id-Modus (Beispiel nach PP client_with_id_references.xml)
  const i = parseXml(`<client id="1"><securities><security id="2"><uuid>a</uuid><latest id="3" t="2024-08-05" v="10"/></security>
    <security id="4"><uuid>b</uuid><latest reference="3"/></security></securities><back reference="2"/></client>`);
  const secs = kids(child(i, 'securities'), 'security');
  check('id: latest via reference', child(secs[1], 'latest').attrs.t === '2024-08-05');
  check('id: ref to security', child(child(i, 'back'), 'uuid').text === 'a');
  check('id: deref of non-ref is identity', deref(secs[0]) === secs[0]);

  // Dateiformate
  const xmlText = '<client><version>70</version></client>';
  const enc = s => new TextEncoder().encode(s).buffer;
  check('file: plain xml', (await readPortfolioFile(enc(xmlText))).text === xmlText);
  check('file: xml with BOM', (await readPortfolioFile(enc('﻿' + xmlText))).text.startsWith('<client>'));
  check('file: zip', (await readPortfolioFile(await makeZip([['data.xml', xmlText]]))).text === xmlText);
  check('file: zip java-style data descriptor', (await readPortfolioFile(await makeZip([['meta.txt', 'x'], ['data.xml', xmlText]], { javaStyle: true }))).text === xmlText);
  for (const [name, buf] of [['binary', new Uint8Array([0x50, 0x50, 0x50, 0x42, 0x56, 1, 2, 3]).buffer], ['zip without xml or portfolio', await makeZip([['meta.txt', 'PPPBV1']])]]) {
    let err = null; try { await readPortfolioFile(buf); } catch (e) { err = e; }
    check('file: ' + name + ' -> UNSUPPORTED_FORMAT', err && err.message === 'UNSUPPORTED_FORMAT', err && err.message);
  }

  // B5: Wohlgeformtheit – offene Elemente und falsch geschachtelte Tags sind Fehler
  const { readFileSync } = await import('node:fs');
  const broken = s => { try { parseXml(s); return 'OK'; } catch (e) { return e.message; } };
  check('B5: mismatched close', broken('<a><b></a></b>') === 'XML_BROKEN', broken('<a><b></a></b>'));
  check('B5: unclosed root', broken('<client><securities></securities>') === 'XML_BROKEN');
  check('B5: stray close', broken('<a></a></b>') === 'XML_BROKEN');
  check('B5: self-closing root ok', broken('<client/>') === 'OK');
  check('B5: whitespace in closing tag ok', broken('<a><b>1</b ></a\n>') === 'OK');
  for (const f of ['xpath.xml', 'transfer.xml', 'altbestand.xml']) check('B5: fixture still loads ' + f, broken(readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8')) === 'OK');
  // B6: Leserfehler erscheinen einheitlich als UNSUPPORTED_FORMAT
  const load6 = g("loadPortfolioData"), enc6 = s => new TextEncoder().encode(s).buffer, code6 = p => p.then(() => 'OK', e => e.message);
  check('B6: truncated XML -> UNSUPPORTED_FORMAT', await code6(load6(enc6('<client><portfolios><portfolio>'))) === 'UNSUPPORTED_FORMAT');
  check('B6: broken reference -> UNSUPPORTED_FORMAT', await code6(load6(enc6('<client><portfolios><portfolio reference="../nix"/></portfolios></client>'))) === 'UNSUPPORTED_FORMAT');
  const pbBad = new Uint8Array([...new TextEncoder().encode('PPPBV1'), 0x80]);
  check('B6: truncated protobuf -> UNSUPPORTED_FORMAT', await code6(load6(await makeZip([['data.portfolio', pbBad]]))) === 'UNSUPPORTED_FORMAT');
  check('B6: valid file still loads', await code6(load6(enc6('<client><securities/><accounts/><portfolios><portfolio><uuid>p</uuid><name>D</name><transactions/></portfolio></portfolios></client>'))) === 'OK');

  // Schlussprüfung M1: „>“ und „/>“ innerhalb eines Attributwerts beenden das Tag nicht
  const q1 = parseXml('<client><a note="a/>b" x=\'>\'>t</a><b k="1"/></client>');
  check('M1: quoted > and /> inside attributes', q1.children.length === 2 && q1.children[0].attrs.note === 'a/>b' && q1.children[0].attrs.x === '>' && q1.children[0].text === 't' && q1.children[1].attrs.k === '1', q1.children.map(c => [c.name, c.attrs, c.text]));
  check('M1: unterminated quote is broken', broken('<a x="1><b/></a>') === 'XML_BROKEN');
};
