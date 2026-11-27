// Kleiner XML-Leser für Portfolio-Performance-Dateien (XStream) samt Auflösung von reference-Attributen.
// Unterstützt beide XStream-Modi: relative XPath-Pfade und id/reference-Nummern.
const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const xmlDecode = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (XML_ENT[e] ?? m));
const XML_ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseXml(s) {
  const doc = { root: null, ids: new Map() };
  const stack = [];
  let cur = null, i = 0, text = '';
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) break;
    if (cur && lt > i) text += s.slice(i, lt);
    const until = (mark, from) => { const e = s.indexOf(mark, from); if (e < 0) throw new Error('XML_BROKEN'); return e; };
    if (s.startsWith('<!--', lt)) { i = until('-->', lt) + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = until(']]>', lt); if (cur) text += '\u0000' + s.slice(lt + 9, e); i = e + 3; continue; }
    if (s[lt + 1] === '?' || s[lt + 1] === '!') { i = until('>', lt) + 1; continue; }
    let gt = s.indexOf('>', lt);
    if (gt < 0) throw new Error('XML_BROKEN');
    // „>“ innerhalb eines Attributwerts beendet das Tag nicht: nur wenn Anführungszeichen vorkommen, zeichenweise bis zum echten Ende gehen
    if (s[lt + 1] !== '/' && /["']/.test(s.slice(lt, gt))) {
      let quote = '';
      for (gt = lt + 1; gt < n; gt++) { const c = s[gt]; if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c; else if (c === '>') break; }
      if (gt >= n) throw new Error('XML_BROKEN');
    }
    if (s[lt + 1] === '/') {
      // schließendes Tag muss zum offenen Element passen (sonst: falsch geschachtelt oder beschädigt)
      if (!cur || s.slice(lt + 2, gt).trim() !== cur.name) throw new Error('XML_BROKEN');
      cur.text = textOf(text); text = '';
      cur = stack.pop() || null;
      i = gt + 1; continue;
    }
    const selfClose = s[gt - 1] === '/';
    const body = s.slice(lt + 1, selfClose ? gt - 1 : gt);
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    const attrs = {};
    if (sp >= 0) { XML_ATTR.lastIndex = 0; let m; while ((m = XML_ATTR.exec(body))) attrs[m[1]] = xmlDecode(m[2] ?? m[3]); }
    const node = { name, attrs, children: [], text: '', parent: cur, doc };
    if (attrs.id !== undefined) doc.ids.set(attrs.id, node);
    if (cur) cur.children.push(node); else if (!doc.root) doc.root = node;
    text = '';
    if (!selfClose) { if (cur) stack.push(cur); cur = node; }
    i = gt + 1;
  }
  if (!doc.root || cur) throw new Error('XML_BROKEN'); // cur: Datei endet mit offenem Element (abgeschnitten)
  return doc.root;
}
// CDATA-Teile (mit \0 markiert) bleiben roh, der Rest wird dekodiert
function textOf(t) {
  if (t.indexOf('\u0000') < 0) return xmlDecode(t).trim();
  return t.split('\u0000').map((p, k) => k ? p : xmlDecode(p)).join('').trim();
}

function xmlResolve(node) {
  const ref = node.attrs.reference, doc = node.doc;
  if (doc.root.attrs.id !== undefined) {
    const t = doc.ids.get(ref);
    if (!t) throw new Error('BROKEN_REFERENCE ' + ref);
    return t;
  }
  let t = node;
  for (const seg of ref.split('/')) {
    if (seg === '..') { t = t.parent; }
    else if (seg !== '.' && seg !== '') {
      const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(seg);
      const idx = m[2] ? +m[2] : 1;
      let k = 0, found = null;
      for (const c of t.children) if (c.name === m[1] && ++k === idx) { found = c; break; }
      t = found;
    }
    if (!t) throw new Error('BROKEN_REFERENCE ' + ref);
  }
  return t;
}
function deref(node) {
  let t = node, guard = 0;
  while (t && t.attrs.reference !== undefined) {
    t = xmlResolve(t);
    if (++guard > 64) throw new Error('BROKEN_REFERENCE loop');
  }
  return t;
}
function child(node, name) {
  node = deref(node);
  if (!node) return null;
  for (const c of node.children) if (c.name === name) return deref(c);
  return null;
}
function kids(node, name) {
  node = deref(node);
  return node ? node.children.filter(c => c.name === name).map(deref) : [];
}
const childText = (node, name) => { const c = child(node, name); return c ? c.text : ''; };
