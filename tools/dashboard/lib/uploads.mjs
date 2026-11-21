// Upload store (plan Phase 19, step 19.10). Keeps the files Ivan attaches to a Hub chat message until Claude has them.
// Contract: docs/plan/phases/19-attachments-fork.md. Design and real tests: docs/reference/CLAUDE_CONTROL.md (T26 to T31).
// - Files live in the Hub's own git-ignored folder `.claude/hub-uploads/<chat key>/<random name>.<ext>`. The person's file
//   name is NEVER part of a path: it is cleaned and kept only as a display name in the store's index.
// - The kind is decided by the FIRST BYTES (PNG, JPEG, GIF, WebP, PDF; text = valid UTF-8 with no zero bytes), never by the
//   name or by what the browser claims. SVG, web pages and anything else are refused with a plain sentence.
// - An upload id is an opaque random id (32 hex characters), never a path; get() only returns files this store wrote.
//   node tools/dashboard/lib/uploads.mjs --selftest
import { readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, lstatSync, rmSync, rmdirSync, existsSync, utimesSync } from "node:fs";
import { join, dirname, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, "..", "..", "..");
export const DEFAULT_UPLOAD_DIR = join(HUB, ".claude", "hub-uploads");

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{32}$/;
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/; // a Hub chat id (h-...) or "new" (a chat that is being started)
const INDEX = "index.json";
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "application/pdf": ".pdf",
  "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv", "application/json": ".json" };

export const UPLOAD_MESSAGES = {
  empty: "The file is empty.",
  notBytes: "The file did not arrive. Try attaching it again.",
  badChat: "Unknown chat.",
  kind: "This kind of file can't be attached. Use a picture (PNG, JPEG, GIF or WebP), a PDF, or a text file (text, Markdown, CSV or JSON).",
  web: "SVG pictures and web pages can't be attached.",
  full: "The Hub's folder for attached files is full. Files older than a week are removed by themselves; try again later.",
  notList: "Attachments must be a list of attached files.",
  gone: "One of the attached files is no longer there. Attach it again.",
  twice: "The same file was attached twice.",
};

const words = (n) => (n >= MB ? `${+(n / MB).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

/** The kind of a file from its first bytes: { kind, mediaType } or { error }. `name` only picks the label of a text file. */
export function sniff(buf, name = "") {
  const b = buf;
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: "image", mediaType: "image/png" };
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { kind: "image", mediaType: "image/jpeg" };
  if (b.length >= 6 && (b.toString("latin1", 0, 6) === "GIF87a" || b.toString("latin1", 0, 6) === "GIF89a")) return { kind: "image", mediaType: "image/gif" };
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return { kind: "image", mediaType: "image/webp" };
  if (b.length >= 5 && b.toString("latin1", 0, 5) === "%PDF-") return { kind: "pdf", mediaType: "application/pdf" };
  if (b.includes(0)) return { error: UPLOAD_MESSAGES.kind };
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return { error: UPLOAD_MESSAGES.kind }; }
  const head = text.replace(/^\uFEFF/, "").trimStart();
  if (/^<(\?xml|svg\b|!doctype\b|html\b|head\b|body\b|script\b|iframe\b)/i.test(head) || (head.startsWith("<") && /<svg\b/i.test(head.slice(0, 2048)))) return { error: UPLOAD_MESSAGES.web };
  if (/^[\[{]/.test(head)) { try { JSON.parse(head); return { kind: "text", mediaType: "application/json" }; } catch { /* not JSON */ } }
  const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(String(name)) || [])[1]?.toLowerCase();
  return { kind: "text", mediaType: ext === "md" || ext === "markdown" ? "text/markdown" : ext === "csv" ? "text/csv" : "text/plain" };
}

/** A display name: the last part of the given name, no folders, no control or Windows-reserved characters, at most 80 characters. */
export function cleanName(original) {
  let n = String(original ?? "").split(/[\\/]/).pop() || "";
  n = n.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "");
  if (n.length > 80) { const m = /(\.[A-Za-z0-9]{1,8})$/.exec(n); n = m ? n.slice(0, 80 - m[1].length) + m[1] : n.slice(0, 80); }
  return n || "file";
}

export function makeUploads(opts = {}) {
  const dir = resolve(opts.dir || DEFAULT_UPLOAD_DIR);
  const now = typeof opts.now === "function" ? opts.now : () => Date.now();
  const bigCap = Number.isInteger(opts.maxFileBytes) && opts.maxFileBytes > 0 ? opts.maxFileBytes : 10 * MB; // pictures and PDFs
  const textCap = Math.min(MB, bigCap); // text, Markdown, CSV, JSON
  const maxPerMessage = Number.isInteger(opts.maxPerMessage) && opts.maxPerMessage > 0 ? opts.maxPerMessage : 4;
  const keepDays = typeof opts.keepDays === "number" && opts.keepDays > 0 ? opts.keepDays : 7;
  const maxTotal = Number.isInteger(opts.maxTotalBytes) && opts.maxTotalBytes > 0 ? opts.maxTotalBytes : 200 * MB;
  const indexPath = join(dir, INDEX);

  function readIndex() {
    try { const v = JSON.parse(readFileSync(indexPath, "utf8")); if (v && typeof v.files === "object" && v.files) return v; } catch { /* none yet */ }
    return { files: {} };
  }
  function writeIndex(ix) {
    mkdirSync(dir, { recursive: true });
    const tmp = indexPath + "." + process.pid + ".tmp";
    writeFileSync(tmp, JSON.stringify(ix, null, 1));
    for (let i = 0; ; i++) { try { renameSync(tmp, indexPath); return; } catch (e) { if (i >= 20) throw e; } }
  }
  /** The absolute path of a record's file, only when it is inside the store's folder. */
  function inside(rel) {
    if (typeof rel !== "string" || !rel) return null;
    const p = resolve(dir, rel);
    return p.startsWith(dir + sep) && basename(p) !== INDEX ? p : null;
  }
  function plainFile(p) { try { const s = lstatSync(p); return s.isFile() ? s : null; } catch { return null; } }

  function save({ chatKey, bytes, originalName } = {}) {
    if (typeof chatKey !== "string" || !KEY_RE.test(chatKey)) return { ok: false, error: UPLOAD_MESSAGES.badChat };
    if (!(bytes instanceof Uint8Array)) return { ok: false, error: UPLOAD_MESSAGES.notBytes };
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (buf.length === 0) return { ok: false, error: UPLOAD_MESSAGES.empty };
    if (buf.length > bigCap) return { ok: false, error: `Files can be at most ${words(bigCap)}.` };
    const name = cleanName(originalName);
    const t = sniff(buf, name);
    if (t.error) return { ok: false, error: t.error };
    if (t.kind === "image" && buf.length > bigCap) return { ok: false, error: `Pictures can be at most ${words(bigCap)}.` };
    if (t.kind === "pdf" && buf.length > bigCap) return { ok: false, error: `PDF files can be at most ${words(bigCap)}.` };
    if (t.kind === "text" && buf.length > textCap) return { ok: false, error: `Text files can be at most ${words(textCap)}.` };
    const ix = readIndex();
    const used = Object.values(ix.files).reduce((n, r) => n + (Number(r.bytes) || 0), 0);
    if (used + buf.length > maxTotal) return { ok: false, error: UPLOAD_MESSAGES.full };
    let uploadId; do uploadId = randomBytes(16).toString("hex"); while (ix.files[uploadId]);
    const rel = chatKey + "/" + randomBytes(12).toString("hex") + EXT[t.mediaType];
    const abs = inside(rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf, { flag: "wx" }); // never overwrites
    ix.files[uploadId] = { chatKey, kind: t.kind, mediaType: t.mediaType, name, bytes: buf.length, file: rel, savedAt: now() };
    try { writeIndex(ix); } catch (e) { try { rmSync(abs, { force: true }); } catch { /* best effort */ } throw e; }
    return { ok: true, uploadId, kind: t.kind, mediaType: t.mediaType, name, bytes: buf.length };
  }

  /** { path, kind, mediaType, bytes, name, chatKey } of a file this store wrote, or null. */
  function get(uploadId) {
    if (typeof uploadId !== "string" || !ID_RE.test(uploadId)) return null;
    const r = readIndex().files[uploadId];
    if (!r || typeof r !== "object") return null;
    const p = inside(r.file);
    const s = p && plainFile(p);
    if (!s || s.size !== r.bytes) return null;
    return { path: p, kind: r.kind, mediaType: r.mediaType, bytes: r.bytes, name: r.name, chatKey: r.chatKey };
  }

  /** The files of one message: every id known, of this chat, no repeats, at most maxPerMessage. */
  function resolveIds({ chatKey, uploadIds } = {}) {
    if (!Array.isArray(uploadIds)) return { ok: false, error: UPLOAD_MESSAGES.notList };
    if (uploadIds.length > maxPerMessage) return { ok: false, error: `At most ${maxPerMessage} files per message.` };
    if (new Set(uploadIds).size !== uploadIds.length) return { ok: false, error: UPLOAD_MESSAGES.twice };
    const files = [];
    for (const id of uploadIds) {
      const g = get(id);
      if (!g || g.chatKey !== chatKey) return { ok: false, error: UPLOAD_MESSAGES.gone };
      files.push({ uploadId: id, ...g });
    }
    return { ok: true, files };
  }

  /** The record of a stored file found by its file name or path (for showing a cleaned name instead of the random one), or null. */
  function lookupFile(pathOrName) {
    const b = basename(String(pathOrName ?? "").replace(/\\/g, "/"));
    if (!/^[0-9a-f]{24}\.[a-z]{2,4}$/.test(b)) return null;
    for (const [uploadId, r] of Object.entries(readIndex().files)) if (r && typeof r.file === "string" && basename(r.file) === b) return { uploadId, name: r.name, kind: r.kind, mediaType: r.mediaType, bytes: r.bytes };
    return null;
  }

  function remove(uploadId) {
    if (typeof uploadId !== "string" || !ID_RE.test(uploadId)) return false;
    const ix = readIndex(); const r = ix.files[uploadId];
    if (!r) return false;
    const p = inside(r.file);
    if (p && plainFile(p)) { try { rmSync(p, { force: true }); } catch { /* left for cleanup */ } }
    delete ix.files[uploadId]; writeIndex(ix);
    if (p) { try { rmdirSync(dirname(p)); } catch { /* not empty */ } }
    return true;
  }

  /** Delete files older than keepDays (and index lines whose file is gone), files nobody recorded once they are that old, and empty folders. */
  function cleanup() {
    const out = { removedFiles: 0, removedFolders: 0 };
    if (!existsSync(dir)) return out;
    const limit = now() - keepDays * DAY;
    const ix = readIndex(); let changed = false; const known = new Set();
    for (const [id, r] of Object.entries(ix.files)) {
      const p = r && inside(r.file);
      const s = p && plainFile(p);
      if (!s || !(Number(r.savedAt) >= limit)) {
        if (s) { try { rmSync(p, { force: true }); out.removedFiles++; } catch { /* next time */ } }
        delete ix.files[id]; changed = true;
      } else known.add(p);
    }
    if (changed) writeIndex(ix);
    let subs = [];
    try { subs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && KEY_RE.test(d.name)); } catch { /* none */ }
    for (const d of subs) {
      const folder = join(dir, d.name);
      let left = 0;
      for (const f of readdirSync(folder, { withFileTypes: true })) {
        const p = join(folder, f.name);
        if (!f.isFile() || known.has(p)) { left++; continue; }
        const s = plainFile(p);
        if (s && s.mtimeMs < limit) { try { rmSync(p, { force: true }); out.removedFiles++; continue; } catch { /* next time */ } }
        left++;
      }
      if (!left) { try { rmdirSync(folder); out.removedFolders++; } catch { /* not empty */ } }
    }
    return out;
  }

  return { save, get, resolve: resolveIds, lookupFile, remove, cleanup, dir, maxPerMessage };
}

// ---------- self-test ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  let bad = 0;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) bad++; };
  const base = join(tmpdir(), "hub-uploads-test-" + process.pid);
  let clock = Date.parse("2026-11-21T10:00:00Z");
  const u = makeUploads({ dir: join(base, "up"), now: () => clock });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
  const gif = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(20, 2)]);
  const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([1, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1"), Buffer.alloc(20, 3)]);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n", "latin1");
  try {
    const cases = [["a.png", png, "image", "image/png"], ["b.jpg", jpg, "image", "image/jpeg"], ["c.gif", gif, "image", "image/gif"], ["d.webp", webp, "image", "image/webp"],
      ["e.pdf", pdf, "pdf", "application/pdf"], ["notes.txt", Buffer.from("hello\nworld"), "text", "text/plain"], ["plan.md", Buffer.from("# Plan\n- one"), "text", "text/markdown"],
      ["t.csv", Buffer.from("a,b\n1,2"), "text", "text/csv"], ["x.json", Buffer.from('{"a": [1, 2]}'), "text", "application/json"]];
    const saved = {};
    for (const [n, b, kind, mt] of cases) { const r = u.save({ chatKey: "h-20261121-100000-abcd", bytes: b, originalName: n }); saved[n] = r; ok(`accepted ${n} as ${kind} ${mt}`, r.ok === true && r.kind === kind && r.mediaType === mt && r.bytes === b.length && r.name === n && /^[0-9a-f]{32}$/.test(r.uploadId)); }
    const g = u.get(saved["a.png"].uploadId);
    ok("get() gives a path inside the store, under the chat key, with a random name (not the person's)", !!g && g.path.startsWith(resolve(base, "up", "h-20261121-100000-abcd") + sep) && /^[0-9a-f]{24}\.png$/.test(basename(g.path)) && basename(g.path) !== "a.png" && !g.path.split(/[\\/]/).includes("a.png"));
    ok("the stored bytes are the same", !!g && readFileSync(g.path).equals(png));
    ok("an upload id is never a path: the id is not in the file name", !g.path.includes(saved["a.png"].uploadId));
    const fake = u.save({ chatKey: "new", bytes: Buffer.from("just some words, not a picture"), originalName: "photo.png" });
    ok("a text file renamed .png is treated as text by its bytes (stored as .txt)", fake.ok === true && fake.kind === "text" && fake.mediaType === "text/plain" && u.get(fake.uploadId).path.endsWith(".txt"));
    const pngAsTxt = u.save({ chatKey: "new", bytes: png, originalName: "readme.txt" });
    ok("a PNG named .txt is a picture by its bytes", pngAsTxt.ok === true && pngAsTxt.kind === "image" && pngAsTxt.mediaType === "image/png");
    const svg = u.save({ chatKey: "new", bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'), originalName: "logo.svg" });
    const svg2 = u.save({ chatKey: "new", bytes: Buffer.from('\uFEFF  <?xml version="1.0"?>\n<svg></svg>'), originalName: "logo.txt" });
    const html = u.save({ chatKey: "new", bytes: Buffer.from("<!DOCTYPE html><html><body>hi</body></html>"), originalName: "page.md" });
    ok("SVG refused (also with an XML header and a text name); web pages refused", [svg, svg2, html].every((r) => r.ok === false && r.error === UPLOAD_MESSAGES.web));
    const bin = u.save({ chatKey: "new", bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 1, 2]), originalName: "a.zip" });
    const latin = u.save({ chatKey: "new", bytes: Buffer.from([0x63, 0x61, 0x66, 0xe9]), originalName: "x.txt" });
    ok("other files refused with the plain sentence (zip, bytes that are not UTF-8)", bin.ok === false && bin.error === UPLOAD_MESSAGES.kind && latin.ok === false && latin.error === UPLOAD_MESSAGES.kind);
    ok("an empty file refused", u.save({ chatKey: "new", bytes: Buffer.alloc(0), originalName: "x.txt" }).error === UPLOAD_MESSAGES.empty);
    ok("not bytes refused", u.save({ chatKey: "new", bytes: "hello", originalName: "x.txt" }).error === UPLOAD_MESSAGES.notBytes);
    ok("a bad chat key refused (path tricks, empty, too long)", ["../x", "..", "a/b", "a\\b", "", "C:", "x".repeat(65), " new", 5].every((k) => u.save({ chatKey: k, bytes: png, originalName: "a.png" }).error === UPLOAD_MESSAGES.badChat));
    const big = Buffer.concat([png, Buffer.alloc(10 * MB, 1)]);
    ok("a picture over 10 MB refused", u.save({ chatKey: "new", bytes: big, originalName: "big.png" }).error === "Files can be at most 10 MB.");
    const bigText = Buffer.alloc(MB + 1, 0x61);
    ok("a text file over 1 MB refused; exactly 1 MB accepted", u.save({ chatKey: "new", bytes: bigText, originalName: "a.txt" }).error === "Text files can be at most 1 MB." && u.save({ chatKey: "new", bytes: bigText.subarray(0, MB), originalName: "a.txt" }).ok === true);
    const small = makeUploads({ dir: join(base, "small"), now: () => clock, maxFileBytes: 100 });
    ok("maxFileBytes caps pictures and PDFs (plain sentence)", small.save({ chatKey: "new", bytes: Buffer.concat([pdf, Buffer.alloc(80, 0x20)]), originalName: "a.pdf" }).error === "Files can be at most 100 bytes." && small.save({ chatKey: "new", bytes: pdf, originalName: "a.pdf" }).ok === true);
    const tricks = ["../../etc/passwd", "..\\..\\Windows\\win.ini", "C:\\Users\\Ivan\\Secret Plan.pdf", "a\u0000b<>:\"|?*.txt", "...", "  ", "/", "x".repeat(200) + ".txt"];
    const tr = tricks.map((n) => u.save({ chatKey: "new", bytes: Buffer.from("text " + n.length), originalName: n }));
    ok("path tricks in names: kept only as a cleaned display name", tr.every((r) => r.ok) && tr[0].name === "passwd" && tr[1].name === "win.ini" && tr[2].name === "Secret Plan.pdf" && tr[3].name === "ab.txt" && tr[4].name === "file" && tr[5].name === "file" && tr[6].name === "file" && tr[7].name.length === 80 && tr[7].name.endsWith(".txt"));
    ok("...and never in the stored path", tr.every((r) => { const p = u.get(r.uploadId).path; return p.startsWith(resolve(base, "up", "new") + sep) && /^[0-9a-f]{24}\.txt$/.test(basename(p)); }));
    ok("get() refuses ids that are not ids or not known", [null, 5, "", "../index", "x".repeat(32), "0".repeat(32), saved["a.png"].uploadId.toUpperCase()].every((x) => u.get(x) === null));
    writeFileSync(join(base, "up", "planted.txt"), "x");
    const ix = JSON.parse(readFileSync(join(base, "up", INDEX), "utf8"));
    ix.files["f".repeat(32)] = { chatKey: "new", kind: "text", mediaType: "text/plain", name: "p", bytes: 1, file: "../planted-outside.txt", savedAt: clock };
    ix.files["e".repeat(32)] = { chatKey: "new", kind: "text", mediaType: "text/plain", name: "p", bytes: 1, file: "index.json", savedAt: clock };
    writeFileSync(join(base, "planted-outside.txt"), "x");
    writeFileSync(join(base, "up", INDEX), JSON.stringify(ix));
    ok("get() never returns a file outside the store or the index itself, even from an edited index", u.get("f".repeat(32)) === null && u.get("e".repeat(32)) === null);
    const p1 = u.get(saved["notes.txt"].uploadId).path; writeFileSync(p1, "changed size!!");
    ok("get() refuses a stored file whose size changed", u.get(saved["notes.txt"].uploadId) === null);
    // resolve (one message)
    const k = "h-20261121-100000-abcd";
    const ids = ["a.png", "b.jpg", "c.gif", "d.webp", "e.pdf"].map((n) => saved[n].uploadId);
    const r4 = u.resolve({ chatKey: k, uploadIds: ids.slice(0, 4) });
    ok("resolve: 4 files of this chat ok, in order", r4.ok === true && r4.files.length === 4 && r4.files.map((f) => f.uploadId).join() === ids.slice(0, 4).join() && r4.files[0].kind === "image");
    ok("resolve: 5 refused (too many)", u.resolve({ chatKey: k, uploadIds: ids }).error === "At most 4 files per message.");
    ok("resolve: a repeat refused", u.resolve({ chatKey: k, uploadIds: [ids[0], ids[0]] }).error === UPLOAD_MESSAGES.twice);
    ok("resolve: another chat's file refused like an unknown one", u.resolve({ chatKey: "new", uploadIds: [ids[0]] }).error === UPLOAD_MESSAGES.gone && u.resolve({ chatKey: k, uploadIds: ["0".repeat(32)] }).error === UPLOAD_MESSAGES.gone);
    ok("resolve: not a list refused", u.resolve({ chatKey: k, uploadIds: "abc" }).error === UPLOAD_MESSAGES.notList);
    ok("lookupFile finds the display name from the stored path only", u.lookupFile(u.get(ids[0]).path).name === "a.png" && u.lookupFile("C:/elsewhere/a.png") === null);
    // remove
    ok("remove deletes the file and the record", u.remove(ids[4]) === true && u.get(ids[4]) === null && u.remove(ids[4]) === false && u.remove("../x") === false);
    // total cap
    const tiny = makeUploads({ dir: join(base, "tiny"), now: () => clock, maxTotalBytes: 100 });
    ok("the folder cap refuses with a plain sentence", tiny.save({ chatKey: "new", bytes: Buffer.alloc(60, 0x61), originalName: "a" }).ok === true && tiny.save({ chatKey: "new", bytes: Buffer.alloc(60, 0x61), originalName: "b" }).error === UPLOAD_MESSAGES.full);
    // cleanup with a fake clock
    const c = makeUploads({ dir: join(base, "clean"), now: () => clock });
    const old = c.save({ chatKey: "h-old", bytes: png, originalName: "old.png" });
    clock += 6 * DAY;
    const fresh = c.save({ chatKey: "h-new", bytes: png, originalName: "new.png" });
    mkdirSync(join(base, "clean", "h-empty"));
    const orphanNew = join(base, "clean", "h-new", "0".repeat(24) + ".txt"), orphanOld = join(base, "clean", "h-new", "1".repeat(24) + ".txt");
    writeFileSync(orphanNew, "unrecorded, written at day 6"); utimesSync(orphanNew, new Date(clock), new Date(clock));
    writeFileSync(orphanOld, "unrecorded, written at day -2"); utimesSync(orphanOld, new Date(clock - 8 * DAY), new Date(clock - 8 * DAY));
    ok("cleanup at day 6: only an unrecorded file older than 7 days (by its file time) goes, and the empty folder", (() => { const r = c.cleanup(); return r.removedFiles === 1 && !existsSync(orphanOld) && r.removedFolders === 1 && !!c.get(old.uploadId) && !!c.get(fresh.uploadId); })());
    clock += 1.5 * DAY;
    const r2 = c.cleanup();
    ok("cleanup at day 7.5: the 7-day-old file and its empty folder removed, the newer one kept", r2.removedFiles === 1 && r2.removedFolders === 1 && c.get(old.uploadId) === null && !!c.get(fresh.uploadId) && !existsSync(join(base, "clean", "h-old")));
    ok("cleanup keeps an unrecorded file that is not old (by its real time)", existsSync(orphanNew));
    ok("cleanup on a folder that does not exist does nothing", makeUploads({ dir: join(base, "nothing") }).cleanup().removedFiles === 0 && !existsSync(join(base, "nothing")));
  } catch (err) { ok("self-test crashed: " + (err && err.stack), false); }
  try { rmSync(base, { recursive: true, force: true }); } catch { /* temp only */ }
  process.exitCode = bad ? 1 : 0;
}
