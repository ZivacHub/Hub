// Small, safe markdown renderer for Claude's replies (Phase 19). Hand-written, no library.
// parseMarkdown(text) -> AST (pure, testable in Node). renderMarkdown(text, { document }) -> DocumentFragment.
// Safety: elements are only built with createElement / createTextNode, never innerHTML, so raw HTML in the
// text is shown as text. Links are only made for http: and https: addresses.

export const MAX_CHARS = 60000;
const CUT_NOTE = "\u2026 (cut)";
const MAX_LIST_DEPTH = 3;
const MAX_QUOTE_DEPTH = 4;
const MAX_INLINE_DEPTH = 5;
const WINDOW = 3000; // how far an inline marker looks for its partner

const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,4})(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])(?: +(.*))?$/;
const SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const PUNCT = "\\`*_{}[]()#+-.!|>~<\"'&/:@=%$^;,?";

function indentOf(line) { let n = 0; while (n < line.length && line[n] === " ") n++; return n; }
function isBlank(line) { return /^\s*$/.test(line); }

// ---------- URLs ----------
export function isSafeUrl(url) {
  if (typeof url !== "string" || url.length > 2000) return false;
  if (!/^https?:\/\/[^\s<>"`\\\u0000-\u001f\u007f]+$/i.test(url)) return false;
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch { return false; }
}

// ---------- inline ----------
function isAlnum(c) { return c !== undefined && /[A-Za-z0-9]/.test(c); }
function isSpace(c) { return c === undefined || /\s/.test(c); }

function trimUrl(u) {
  let end = u.length;
  for (;;) {
    const ch = u[end - 1];
    if (end > 0 && ".,;:!?*_'~".includes(ch)) { end--; continue; }
    if (end > 0 && (ch === ")" || ch === "]" || ch === "}")) {
      const open = ch === ")" ? "(" : ch === "]" ? "[" : "{";
      const body = u.slice(0, end);
      const opens = body.split(open).length - 1, closes = body.split(ch).length - 1;
      if (closes > opens) { end--; continue; }
    }
    break;
  }
  return u.slice(0, end);
}

function parseInline(s, depth = 0, noLink = false) {
  const out = [];
  let buf = "";
  let i = 0;
  const n = s.length;
  const flush = () => { if (buf) { out.push({ type: "text", text: buf }); buf = ""; } };
  while (i < n) {
    const c = s[i];
    if (c === "\\" && i + 1 < n && PUNCT.includes(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
    if (c === "\n") { buf = buf.replace(/ +$/, ""); flush(); out.push({ type: "br" }); i++; continue; }
    if (c === "`") {
      let k = 1; while (s[i + k] === "`") k++;
      const run = "`".repeat(k);
      let pos = i + k, found = -1;
      for (let tries = 0; tries < 6; tries++) {
        const j = s.indexOf(run, pos);
        if (j < 0 || j - i > WINDOW) break;
        if (s[j - 1] !== "`" && s[j + k] !== "`") { found = j; break; }
        pos = j + 1;
      }
      if (found > 0) {
        let code = s.slice(i + k, found);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        flush(); out.push({ type: "code", text: code });
        i = found + k; continue;
      }
      buf += run; i += k; continue;
    }
    if ((c === "*" || c === "_") && depth < MAX_INLINE_DEPTH) {
      const double = s[i + 1] === c;
      const d = double ? c + c : c;
      const start = i + d.length;
      const okOpen = !isSpace(s[start]) && (c === "*" || !isAlnum(s[i - 1]));
      if (okOpen) {
        let pos = start, found = -1;
        for (let tries = 0; tries < 8; tries++) {
          let j = s.indexOf(d, pos);
          if (j < 0 || j - i > WINDOW) break;
          if (double) while (s[j + 2] === c && j + 2 < n) j++; // ***x*** closes on the last two
          const after = s[j + d.length];
          const good = j > start && !isSpace(s[j - 1]) && (c === "*" || !isAlnum(after)) && (double || (after !== c && s[j - 1] !== c));
          if (good) { found = j; break; }
          pos = j + 1;
        }
        if (found > 0) {
          flush();
          out.push({ type: double ? "strong" : "em", children: parseInline(s.slice(start, found), depth + 1, noLink) });
          i = found + d.length; continue;
        }
      }
      buf += d; i += d.length; continue;
    }
    if (c === "[" && !noLink && depth < MAX_INLINE_DEPTH) {
      // find the matching ] then ( ... )
      let k = i + 1, level = 1;
      while (k < n && k - i < 1000 && level > 0) { if (s[k] === "\\") k++; else if (s[k] === "[") level++; else if (s[k] === "]") level--; k++; }
      if (level === 0 && s[k] === "(") {
        let l = k + 1, p = 1;
        while (l < n && l - k < 2000 && p > 0) { if (s[l] === "(") p++; else if (s[l] === ")") p--; if (p > 0) l++; }
        if (p === 0) {
          const label = s.slice(i + 1, k - 1);
          let url = s.slice(k + 1, l).trim();
          if (url.startsWith("<") && url.includes(">")) url = url.slice(1, url.indexOf(">"));
          else url = url.split(/\s/)[0];
          if (isSafeUrl(url)) {
            flush(); out.push({ type: "link", href: url, children: parseInline(label, depth + 1, true) });
          } else {
            buf += s.slice(i, l + 1); // unsafe or odd address: shown as plain text, never a link
          }
          i = l + 1; continue;
        }
      }
      buf += c; i++; continue;
    }
    if (c === "h" && !noLink && (s.startsWith("http://", i) || s.startsWith("https://", i)) && !isAlnum(s[i - 1])) {
      const m = /^https?:\/\/[^\s<>"`\\]+/.exec(s.slice(i, i + 2100));
      if (m) {
        const url = trimUrl(m[0]);
        if (isSafeUrl(url)) {
          flush(); out.push({ type: "link", href: url, children: [{ type: "text", text: url }] });
          i += url.length; continue;
        }
      }
    }
    buf += c; i++;
  }
  flush();
  return out;
}

// ---------- blocks ----------
function splitRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (ch === "\\" && t[k + 1] === "|") { cur += "|"; k++; }
    else if (ch === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableStart(lines, i) {
  const line = lines[i];
  if (i + 1 >= lines.length || !line.includes("|")) return false;
  const sep = lines[i + 1];
  if (!sep.includes("|") || !SEP_RE.test(sep)) return false;
  return splitRow(line).length === splitRow(sep).length;
}

function isBlockStart(line, ctx) {
  if (FENCE.test(line) || HEADING.test(line) || HR.test(line)) return true;
  if (ctx.q < MAX_QUOTE_DEPTH && QUOTE.test(line)) return true;
  if (ctx.l < MAX_LIST_DEPTH) {
    const m = LIST.exec(line);
    if (m && m[3] !== undefined && (/^\d/.test(m[2]) ? parseInt(m[2], 10) === 1 : true)) return true;
  }
  return false;
}

function parseBlocks(lines, ctx) {
  const out = [];
  let i = 0;
  const len = lines.length;
  while (i < len) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    let m = FENCE.exec(line);
    if (m) {
      const ind = m[1].length, ch = m[2][0], flen = m[2].length;
      const lang = /^[\w+#.-]{1,24}$/.test(m[3]) ? m[3] : "";
      const buf = [];
      i++;
      while (i < len) {
        const l = lines[i];
        const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(l);
        if (c && c[1][0] === ch && c[1].length >= flen) { i++; break; }
        buf.push(l.slice(Math.min(ind, indentOf(l))));
        i++;
      }
      out.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    m = HEADING.exec(line);
    if (m) { out.push({ type: "heading", level: m[1].length, children: parseInline(m[2] || "") }); i++; continue; }

    if (HR.test(line)) { out.push({ type: "hr" }); i++; continue; }

    if (ctx.q < MAX_QUOTE_DEPTH && QUOTE.test(line)) {
      const buf = [];
      while (i < len) {
        const l = lines[i];
        if (QUOTE.test(l)) buf.push(l.replace(/^ {0,3}> ?/, ""));
        else if (!isBlank(l) && !isBlockStart(l, ctx) && buf.length && !isBlank(buf[buf.length - 1])) buf.push(l);
        else break;
        i++;
      }
      out.push({ type: "quote", children: parseBlocks(buf, { l: ctx.l, q: ctx.q + 1 }) });
      continue;
    }

    m = ctx.l < MAX_LIST_DEPTH ? LIST.exec(line) : null;
    if (m) {
      const b = m[1].length;
      const ordered = /^\d/.test(m[2]);
      const isSibling = (l) => {
        const x = LIST.exec(l);
        return !!x && x[1].length <= b + 1 && /^\d/.test(x[2]) === ordered;
      };
      const list = { type: "list", ordered, start: ordered ? parseInt(m[2], 10) : 1, items: [] };
      while (i < len) {
        const mm = LIST.exec(lines[i]);
        const markerEnd = mm[1].length + mm[2].length;
        // content column: after the marker and the spaces that follow it (at most 4)
        const afterMarker = lines[i].slice(markerEnd);
        const gap = Math.min(afterMarker.length - afterMarker.trimStart().length, 4) || 1;
        const col = markerEnd + gap;
        let first = mm[3] === undefined ? "" : mm[3];
        if (afterMarker.length - afterMarker.trimStart().length > 4) first = afterMarker.slice(1);
        const body = [first];
        let j = i + 1;
        while (j < len) {
          const l = lines[j];
          if (isBlank(l)) {
            let k = j;
            while (k < len && isBlank(lines[k])) k++;
            if (k < len && indentOf(lines[k]) >= b + 2) { for (; j < k; j++) body.push(""); continue; }
            break;
          }
          const ind = indentOf(l);
          if (ind >= b + 2) { body.push(l.slice(Math.min(col, ind))); j++; continue; }
          if (LIST.test(l) && ind <= b + 1) break;
          if (!isBlank(lines[j - 1]) && !isBlockStart(l, ctx)) { body.push(l.trim()); j++; continue; }
          break;
        }
        let task = null;
        const t = /^\[([ xX])\](?:\s+(.*))?$/.exec(body[0]);
        if (t) { task = t[1] !== " "; body[0] = t[2] || ""; }
        list.items.push({ task, children: parseBlocks(body, { l: ctx.l + 1, q: ctx.q }) });
        i = j;
        // next item? (blank lines may sit between items)
        let k = i;
        while (k < len && isBlank(lines[k])) k++;
        if (k < len && isSibling(lines[k])) { i = k; continue; }
        break;
      }
      out.push(list);
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
      const norm = (cells) => { const r = cells.slice(0, head.length); while (r.length < head.length) r.push(""); return r; };
      const rows = [];
      i += 2;
      while (i < len && !isBlank(lines[i]) && lines[i].includes("|")) { rows.push(norm(splitRow(lines[i]))); i++; }
      out.push({
        type: "table", align,
        head: head.map((c) => parseInline(c)),
        rows: rows.map((r) => r.map((c) => parseInline(c))),
      });
      continue;
    }

    // paragraph
    const buf = [line.replace(/^\s+/, "")];
    i++;
    while (i < len && !isBlank(lines[i]) && !isBlockStart(lines[i], ctx) && !isTableStart(lines, i)) {
      buf.push(lines[i].replace(/^\s+/, ""));
      i++;
    }
    out.push({ type: "paragraph", children: parseInline(buf.join("\n")) });
  }
  return out;
}

export function parseMarkdown(text) {
  let s = typeof text === "string" ? text : text == null ? "" : String(text);
  s = s.replace(/\u0000/g, "");
  let cut = false;
  if (s.length > MAX_CHARS) {
    s = s.slice(0, MAX_CHARS);
    if (/[\ud800-\udbff]$/.test(s)) s = s.slice(0, -1);
    cut = true;
  }
  const lines = s.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks = parseBlocks(lines, { l: 0, q: 0 });
  if (cut) blocks.push({ type: "cut", text: CUT_NOTE });
  return blocks;
}

// ---------- rendering ----------
function el(doc, tag, cls, parent) {
  const e = doc.createElement(tag);
  if (cls) e.classList.add(cls);
  if (parent) parent.appendChild(e);
  return e;
}
function txt(doc, parent, text) { parent.appendChild(doc.createTextNode(text)); }

function renderInlines(nodes, parent, doc) {
  for (const n of nodes) {
    if (n.type === "text") txt(doc, parent, n.text);
    else if (n.type === "br") el(doc, "br", null, parent);
    else if (n.type === "code") txt(doc, el(doc, "code", "md-inline-code", parent), n.text);
    else if (n.type === "strong") renderInlines(n.children, el(doc, "strong", null, parent), doc);
    else if (n.type === "em") renderInlines(n.children, el(doc, "em", null, parent), doc);
    else if (n.type === "link") {
      const a = el(doc, "a", null, parent);
      a.setAttribute("href", n.href);
      a.setAttribute("rel", "noopener noreferrer");
      a.setAttribute("target", "_blank");
      renderInlines(n.children, a, doc);
    }
  }
}

function renderBlocks(blocks, parent, doc) {
  for (const b of blocks) {
    if (b.type === "paragraph") renderInlines(b.children, el(doc, "p", null, parent), doc);
    else if (b.type === "heading") renderInlines(b.children, el(doc, "h" + (b.level + 1), "md-h" + b.level, parent), doc);
    else if (b.type === "hr") el(doc, "hr", null, parent);
    else if (b.type === "cut") txt(doc, el(doc, "p", "md-cut", parent), b.text);
    else if (b.type === "code") {
      const wrap = el(doc, "div", "md-codeblock", parent);
      if (b.lang) txt(doc, el(doc, "span", "md-lang", wrap), b.lang);
      const pre = el(doc, "pre", null, wrap);
      txt(doc, el(doc, "code", null, pre), b.text);
    } else if (b.type === "quote") renderBlocks(b.children, el(doc, "blockquote", null, parent), doc);
    else if (b.type === "list") {
      const list = el(doc, b.ordered ? "ol" : "ul", null, parent);
      if (b.ordered && b.start !== 1) list.setAttribute("start", String(b.start));
      for (const it of b.items) {
        const li = el(doc, "li", it.task === null ? null : "md-task", list);
        if (it.task !== null) {
          const mark = el(doc, "span", "md-taskmark", li);
          mark.classList.add(it.task ? "md-done" : "md-todo");
          mark.setAttribute("aria-hidden", "true");
          txt(doc, mark, it.task ? "\u2611" : "\u2610");
          txt(doc, el(doc, "span", "md-taskword", li), it.task ? "done" : "to do");
        }
        renderBlocks(it.children, li, doc);
      }
    } else if (b.type === "table") {
      const wrap = el(doc, "div", "md-tablewrap", parent);
      const table = el(doc, "table", null, wrap);
      const thead = el(doc, "thead", null, table);
      const hr = el(doc, "tr", null, thead);
      b.head.forEach((cell, c) => {
        const th = el(doc, "th", null, hr);
        if (b.align[c]) th.classList.add("md-" + b.align[c]);
        renderInlines(cell, th, doc);
      });
      const tbody = el(doc, "tbody", null, table);
      for (const row of b.rows) {
        const tr = el(doc, "tr", null, tbody);
        row.forEach((cell, c) => {
          const td = el(doc, "td", null, tr);
          if (b.align[c]) td.classList.add("md-" + b.align[c]);
          renderInlines(cell, td, doc);
        });
      }
    }
  }
}

export function renderMarkdown(text, { document: doc = globalThis.document } = {}) {
  const frag = doc.createDocumentFragment();
  renderBlocks(parseMarkdown(text), frag, doc);
  return frag;
}
