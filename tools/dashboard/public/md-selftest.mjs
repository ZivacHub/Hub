// node tools/dashboard/public/md-selftest.mjs  -> checks the markdown renderer with a tiny fake document.
import { parseMarkdown, renderMarkdown, isSafeUrl, MAX_CHARS } from "./md.js";

// ---- tiny fake DOM ----
function makeDoc() {
  const mk = (tag) => {
    const attrs = {}, classes = new Set();
    return {
      nodeType: 1, tagName: tag.toUpperCase(), children: [], attrs,
      classList: { add: (c) => classes.add(c), contains: (c) => classes.has(c), get list() { return [...classes]; } },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      get innerHTML() { throw new Error("innerHTML must never be touched"); },
      set innerHTML(v) { throw new Error("innerHTML must never be set"); },
    };
  };
  return {
    createElement: mk,
    createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
    createDocumentFragment: () => mk("#frag"),
  };
}
const doc = makeDoc();
const render = (t) => renderMarkdown(t, { document: doc });
function html(n) { // serialise for checks (text is escaped so injected markup would show)
  if (n.nodeType === 3) return n.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cls = n.classList.list.length ? ` class="${n.classList.list.join(" ")}"` : "";
  const at = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join("");
  const inner = n.children.map(html).join("");
  if (n.tagName === "BR" || n.tagName === "HR") return `<${n.tagName.toLowerCase()}>`;
  return n.tagName === "#FRAG" ? inner : `<${n.tagName.toLowerCase()}${cls}${at}>${inner}</${n.tagName.toLowerCase()}>`;
}
function walk(n, f) { f(n); (n.children || []).forEach((c) => walk(c, f)); }
const h = (t) => html(render(t));
const tags = (t) => { const s = new Set(); walk(render(t), (n) => n.tagName && s.add(n.tagName.toLowerCase())); return s; };

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) pass++; else { fail++; console.log("FAIL:", name, extra === undefined ? "" : "\n   " + extra); }
}
const has = (name, t, frag) => { const out = h(t); check(name, out.includes(frag), out); };
const lacks = (name, t, frag) => { const out = h(t); check(name, !out.includes(frag), out); };

// ---- paragraphs, line breaks ----
has("paragraph", "hello world", "<p>hello world</p>");
has("two paragraphs", "a\n\nb", "<p>a</p><p>b</p>");
has("line break kept", "a\nb", "<p>a<br>b</p>");
has("windows line endings", "a\r\nb\r\n\r\nc", "<p>a<br>b</p><p>c</p>");
check("empty input", h("") === "" && h("   \n\n") === "");
check("null input", h(null) === "" && h(undefined) === "");

// ---- headings ----
check("heading levels 1-4", [1, 2, 3, 4].every((n) => parseMarkdown("#".repeat(n) + " T")[0].level === n));
has("heading rendered", "## Title", '<h3 class="md-h2">Title</h3>');
check("five hashes is not a heading", parseMarkdown("##### T")[0].type === "paragraph");
has("heading with closing hashes", "# Title #", '>Title</h2>');
has("heading with inline", "# a **b**", "<strong>b</strong></h2>");
has("heading inside a list", "- # Head\n- x", '<li><h2 class="md-h1">Head</h2></li>');

// ---- inline ----
has("bold stars", "a **b** c", "<strong>b</strong>");
has("bold underscores", "a __b__ c", "<strong>b</strong>");
has("italic star", "a *b* c", "<em>b</em>");
has("italic underscore", "a _b_ c", "<em>b</em>");
has("bold italic", "***x***", "<strong><em>x</em></strong>");
lacks("snake_case stays plain", "my_var_name", "<em>");
lacks("math star stays plain", "2 * 3 * 4", "<em>");
has("inline code", "use `a<b>` now", '<code class="md-inline-code">a&lt;b></code>');
lacks("markdown inside code stays plain", "`**x**`", "<strong>");
has("escaped star", "\\*not\\*", "*not*");
lacks("escaped star no em", "\\*not\\*", "<em>");
has("unclosed bold is text", "**oops", "**oops");

// ---- code blocks ----
has("fenced block with language", "```js\nlet a = 1;\n```", '<span class="md-lang">js</span>');
has("fenced block keeps text", "```\n<b>x</b>\n  y\n```", "&lt;b>x&lt;/b>\n  y");
has("tilde fence", "~~~\nx\n~~~", "<pre><code>x</code></pre>");
{
  const ast = parseMarkdown("before\n```py\nprint(1)\nno close");
  check("unclosed fence closes at end", ast.length === 2 && ast[1].type === "code" && ast[1].text === "print(1)\nno close", JSON.stringify(ast));
}
{
  const ast = parseMarkdown("````\n```\ninner\n```\n````\nafter");
  check("longer fence holds shorter one", ast[0].text === "```\ninner\n```" && ast[1].type === "paragraph", JSON.stringify(ast));
}
check("markdown inside fence not parsed", !h("```\n# no\n- no\n**no**\n```").includes("<h"));

// ---- lists ----
has("bullet list", "- a\n- b", "<ul><li><p>a</p></li><li><p>b</p></li></ul>");
has("star and plus bullets", "* a\n+ b", "<ul><li><p>a</p></li>");
has("ordered list", "1. a\n2. b", "<ol><li><p>a</p></li><li><p>b</p></li></ol>");
has("ordered list start", "3. a\n4. b", 'start="3"');
{
  const out = h("- a\n  - b\n    - c\n      - d\n- e");
  check("nested up to 3 levels", (out.match(/<ul/g) || []).length === 3 && out.includes("d"), out);
  check("level 4 is text not a list", out.includes("- d"), out);
}
has("nested ordered in bullet", "- a\n  1. x\n  2. y", "<ol><li><p>x</p></li><li><p>y</p></li></ol>");
has("list item continuation line", "- a\n  more", "<li><p>a<br>more</p></li>");
has("list with blank lines between", "- a\n\n- b", "<li><p>a</p></li><li><p>b</p></li>");
has("code block in list item", "- a\n  ```\n  x\n  ```", "<pre><code>x</code></pre>");
has("task unchecked", "- [ ] write", 'class="md-task"');
check("task markers with words", (() => { const o = h("- [ ] one\n- [x] two"); return o.includes("\u2610") && o.includes("\u2611") && o.includes("to do") && o.includes("done"); })());
check("list after paragraph", h("text\n- a").includes("<ul>"));

// ---- quote, hr, table ----
has("blockquote", "> quoted\n> more", "<blockquote><p>quoted<br>more</p></blockquote>");
has("nested quote", "> a\n>> b", "<blockquote><p>a</p><blockquote>");
has("hr dashes", "a\n\n---\n\nb", "<hr>");
has("hr stars", "***", "<hr>");
{
  const out = h("| a | b |\n|---|:-:|\n| 1 | **2** |\n| 3 |");
  check("table head", out.includes("<th>a</th><th class=\"md-center\">b</th>"), out);
  check("table rows", out.includes("<td>1</td><td class=\"md-center\"><strong>2</strong></td>"), out);
  check("short row padded", out.includes("<td>3</td><td class=\"md-center\"></td>"), out);
  check("table wrapped for scrolling", out.startsWith('<div class="md-tablewrap">'), out);
}
check("pipes without separator are text", !h("a | b\nc | d").includes("<table"));
has("escaped pipe in table cell", "| a |\n|---|\n| x \\| y |", "<td>x | y</td>");

// ---- links ----
has("https link", "[site](https://example.com/a?b=1)", '<a href="https://example.com/a?b=1" rel="noopener noreferrer" target="_blank">site</a>');
has("http link", "[s](http://example.com)", 'href="http://example.com"');
has("bare url becomes link", "see https://example.com/x now", '<a href="https://example.com/x"');
has("bare url drops trailing dot", "go to https://example.com/x.", 'href="https://example.com/x"');
has("bare url in parens", "(https://example.com/x)", 'href="https://example.com/x"');
has("url with parens kept", "https://en.wikipedia.org/wiki/A_(b)", 'href="https://en.wikipedia.org/wiki/A_(b)"');
lacks("javascript link is text", "[x](javascript:alert(1))", "<a");
has("javascript link shown as text", "[x](javascript:alert(1))", "[x](javascript:alert(1))");
lacks("data link is text", "[x](data:text/html;base64,PHNjcmlwdD4=)", "<a");
lacks("claude link is text", "[open](claude://resume/123)", "<a");
lacks("file path link is text", "[f](C:\\Users\\Ivan\\x.txt) [g](file:///C:/x) [h](/etc/passwd) [i](//evil.com)", "<a");
lacks("mixed case JaVaScRiPt", "[x](JaVaScRiPt:alert(1))", "<a");
lacks("whitespace trick", "[x]( javascript:alert(1))", "<a");
lacks("no autolink in inline code", "`https://example.com`", "<a");
check("isSafeUrl", isSafeUrl("https://a.com") && !isSafeUrl("javascript:alert(1)") && !isSafeUrl("https://a.com/\"onmouseover=1") && !isSafeUrl("https://") && !isSafeUrl("ftp://a.com"));
check("all links carry rel and target", (() => { let ok = true, n = 0; walk(render("[a](https://a.com) https://b.com [c](http://c.com)"), (e) => { if (e.tagName === "A") { n++; ok = ok && e.attrs.rel === "noopener noreferrer" && e.attrs.target === "_blank" && /^https?:/.test(e.attrs.href); } }); return ok && n === 3; })());

// ---- injection ----
{
  const bad = "<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<b>bold?</b> <a href=\"javascript:x\">k</a>";
  const out = h(bad), t = tags(bad);
  check("script shown as text", out.includes("&lt;script>alert(1)&lt;/script>"), out);
  check("img onerror shown as text", out.includes("&lt;img src=x onerror=alert(1)>"), out);
  check("<b> shown as text", out.includes("&lt;b>bold?&lt;/b>"), out);
  check("no script/img/b elements", !t.has("script") && !t.has("img") && !t.has("b") && !t.has("iframe"), [...t].join());
  check("no event attributes anywhere", (() => { let ok = true; walk(render(bad), (e) => { for (const k of Object.keys(e.attrs || {})) if (/^on/i.test(k)) ok = false; }); return ok; })());
}
check("only allowed attributes ever set", (() => {
  const src = "# t\n\n- [x] a\n\n1. [l](https://a.com)\n\n| a |\n|---|\n| <i>x</i> |\n\n```js\nx\n```\n\n3. z";
  let ok = true; walk(render(src), (e) => { for (const k of Object.keys(e.attrs || {})) if (!["href", "rel", "target", "start", "aria-hidden"].includes(k)) ok = false; }); return ok;
})());
check("html in table cell is text", h("| a |\n|---|\n| <script>x</script> |").includes("&lt;script>"));
check("html in code block is text", !tags("```\n<script>x</script>\n```").has("script"));
check("html in link label is text", !tags("[<img src=x onerror=1>](https://a.com)").has("img"));

// ---- limits and speed ----
{
  const big = "word ".repeat(300000); // 1.5 MB
  const t0 = performance.now();
  const ast = parseMarkdown(big);
  const frag = render(big);
  const ms = performance.now() - t0;
  check("1 MB input under 1 s", ms < 1000, ms.toFixed(0) + " ms");
  const out = html(frag);
  check("cut after the cap", out.endsWith("\u2026 (cut)</p>") && out.length < MAX_CHARS * 2, out.slice(-60));
  check("cap is 60000 characters", ast[0].type === "paragraph" && MAX_CHARS === 60000);
}
check("short input has no cut note", !h("hi").includes("(cut)"));
{
  const nasty = {
    "star soup": "*a ".repeat(30000), "bracket soup": "[".repeat(60000), "paren soup": "[a](".repeat(15000),
    "backtick soup": "`a ".repeat(20000), "quotes": "> ".repeat(30000) + "x", "deep list": Array.from({ length: 3000 }, (_, i) => " ".repeat(i % 40) + "- a").join("\n"),
    "table soup": "|a|\n|-|\n".repeat(7000), "underscores": "_a ".repeat(20000), "many blank lines": "- a\n" + "\n".repeat(50000) + "- b",
    "url soup": "https://a.b/".repeat(5000),
  };
  for (const [k, v] of Object.entries(nasty)) {
    const t0 = performance.now(); render(v); const ms = performance.now() - t0;
    check("fast on " + k, ms < 1000, ms.toFixed(0) + " ms");
  }
}
check("very long word is kept whole (CSS wraps it)", h("a".repeat(5000)).includes("a".repeat(5000)));
check("unicode kept", h("caf\u00e9 \u2014 \u6f22\u5b57 \ud83d\ude00").includes("\ud83d\ude00"));
check("NUL characters removed", !h("a\u0000b").includes("\u0000"));
check("innerHTML never used (the fake throws if touched)", true);

console.log(`md-selftest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
