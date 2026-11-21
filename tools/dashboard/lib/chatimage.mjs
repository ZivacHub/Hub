// One picture out of a saved chat file (Phase 19: pictures in the chat view). READ-ONLY.
// The server finds the saved file the same way /api/chat-log does (chatlog.mjs resolveChatFile) and passes it here; this module
// never takes a path from a request. m and b are the message and block numbers the chat-log feed gave the picture.
//   node tools/dashboard/lib/chatimage.mjs --selftest
// Contract: docs/plan/phases/19-pictures-pins.md
import { blockSourceOf, readLineAt } from "./chatlog.mjs";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The real picture type from the first bytes: PNG, JPEG, GIF, WebP only. Anything else (SVG, text, PDF...) = null. */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.toString("latin1", 0, 6) === "GIF87a" || buf.toString("latin1", 0, 6) === "GIF89a") return "image/gif";
  if (buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

const fail = (status, error) => ({ ok: false, status, error });
const idx = (v) => { const n = typeof v === "string" && /^\d{1,7}$/.test(v) ? Number(v) : v; return Number.isInteger(n) && n >= 0 && n <= 9_999_999 ? n : null; };

/**
 * file = a saved chat file the CALLER found. Returns { ok:true, mediaType, bytes: Buffer } or { ok:false, status, error }.
 * Status: 400 bad numbers or file, 404 no such picture, 413 bigger than maxBytes, 415 not a PNG/JPEG/GIF/WebP, 422 the data is not valid base64.
 */
export function readChatImage({ file, m, b, maxBytes = MAX_IMAGE_BYTES } = {}) {
  try {
    const mi = idx(m), bi = idx(b);
    if (typeof file !== "string" || !file.endsWith(".jsonl") || mi === null || bi === null) return fail(400, "bad request");
    const cap = Number.isInteger(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, MAX_IMAGE_BYTES) : MAX_IMAGE_BYTES;
    const src = blockSourceOf(file, mi, bi);
    if (!src || !Array.isArray(src.path) || !Number.isInteger(src.line)) return fail(404, "no such picture");
    const row = readLineAt(file, src.line);
    if (!row) return fail(404, "no such picture");
    let node = row;
    for (const k of src.path) { node = node && typeof node === "object" ? node[k] : undefined; }
    const data = node && typeof node === "object" ? (node.source && typeof node.source === "object" ? node.source.data : node.file && typeof node.file === "object" ? node.file.base64 : undefined) : undefined;
    if (typeof data !== "string" || !data) return fail(404, "no such picture");
    if (Math.floor((data.length * 3) / 4) > cap + 3) return fail(413, "picture too big");
    if (!BASE64.test(data) || data.length % 4 === 1) return fail(422, "bad picture data");
    const buf = Buffer.from(data, "base64");
    if (buf.length > cap) return fail(413, "picture too big");
    const mediaType = sniffImage(buf);
    if (!mediaType) return fail(415, "not a PNG, JPEG, GIF or WebP picture");
    return { ok: true, mediaType, bytes: buf };
  } catch { return fail(404, "no such picture"); }
}

// ---------- self-test ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]) && process.argv.includes("--selftest")) {
  const fs = await import("node:fs"); const os = await import("node:os");
  const { parseChat, parseFile } = await import("./chatlog.mjs");
  let ok = 0, total = 0;
  const check = (n, c, x = "") => { total++; if (c) { ok++; console.log("OK   " + n); } else console.log("FAIL " + n + (x ? " " + x : "")); };
  const tmp = fs.mkdtempSync(join(os.tmpdir(), "hub-chatimage-"));
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body-1234567890")]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body-1234567890")]);
  const gif = Buffer.from("GIF89a" + "fake-gif-body-1234567890");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBPVP8 fake")]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const txt = Buffer.from("this is only a text file renamed to .png, not a picture");
  const T = (m) => new Date(Date.parse("2026-11-20T12:00:00Z") + m * 60000).toISOString();
  const U = (m, content) => ({ type: "user", timestamp: T(m), isSidechain: false, message: { role: "user", content } });
  const A = (m, id, content) => ({ type: "assistant", timestamp: T(m), isSidechain: false, message: { id, model: "claude-sonnet-5-5", role: "assistant", content } });
  const img = (buf, type = "image/png") => ({ type: "image", source: { type: "base64", media_type: type, data: buf.toString("base64") } });
  const rows = [
    U(0, [img(png), { type: "text", text: "what colour?" }]),                                                           // m0: b0 picture
    A(1, "a1", [{ type: "text", text: "red" }]),                                                                          // m1
    U(2, "look at @x.png"),                                                                                               // m2
    { type: "attachment", attachment: { type: "file", filename: "C:\\x\\x.png", displayPath: "x.png", content: { type: "image", file: { base64: jpg.toString("base64"), type: "image/jpeg", originalSize: 30 } } } }, // m2 b1
    A(3, "a2", [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "C:\\x\\read.png" } }]),               // m3
    U(3, [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "image", source: { type: "base64", media_type: "image/gif", data: gif.toString("base64") } }] }]),
    U(4, [img(txt), { type: "text", text: "a text file renamed png" }]),                                                  // m4: b0 declared png, bytes are text
    U(5, [img(svg, "image/png")]),                                                                                        // m5: svg bytes declared png
    U(6, [{ type: "image", source: { type: "base64", media_type: "image/png", data: "!!!not base64!!!" } }, { type: "text", text: "bad b64" }]), // m6
    U(7, [img(webp, "image/webp"), { type: "document", title: "a.pdf", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("%PDF-1.4 fake").toString("base64") } }]), // m7: b0 webp, b1 file
  ];
  const lines = rows.map((r) => JSON.stringify(r)); lines.splice(1, 0, "{broken json", "");
  const file = join(tmp, "chat.jsonl"); fs.writeFileSync(file, lines.join("\n") + "\n");
  const feed = parseChat(lines.join("\n")).messages;
  const find = (m, b) => feed[m].blocks[b];
  check("feed and picture reader use the same numbers", feed.length === 8 && find(0, 0).type === "image" && find(0, 0).m === 0 && find(0, 0).b === 0);
  const r0 = readChatImage({ file, m: 0, b: 0 });
  check("image block in Ivan's message: PNG bytes back, exact", r0.ok && r0.mediaType === "image/png" && r0.bytes.equals(png));
  const r2 = readChatImage({ file, m: 2, b: 1 });
  check("attachment line picture: JPEG bytes back", r2.ok && r2.mediaType === "image/jpeg" && r2.bytes.equals(jpg) && find(2, 1).name === "x.png");
  const rt = feed[3].blocks.find((b) => b.type === "image");
  const r3 = readChatImage({ file, m: rt.m, b: rt.b });
  check("Read tool result picture: GIF bytes back, named after the file", r3.ok && r3.mediaType === "image/gif" && r3.bytes.equals(gif) && rt.name === "read.png");
  const r7 = readChatImage({ file, m: 7, b: 0 });
  check("WebP accepted", r7.ok && r7.mediaType === "image/webp" && r7.bytes.equals(webp));
  check("the type comes from the bytes, not the label (JPEG labelled as PNG would be sent as JPEG)", sniffImage(jpg) === "image/jpeg" && sniffImage(png) === "image/png");
  check("a text file renamed .png is refused (415)", readChatImage({ file, m: 4, b: 0 }).status === 415);
  check("SVG bytes labelled image/png are refused (415)", readChatImage({ file, m: 5, b: 0 }).status === 415);
  check("bad base64 is refused (422)", readChatImage({ file, m: 6, b: 0 }).status === 422);
  check("a document block is not a picture (404)", readChatImage({ file, m: 7, b: 1 }).status === 404 && find(7, 1).type === "file");
  check("a text block is not a picture (404)", readChatImage({ file, m: 0, b: 1 }).status === 404);
  check("wrong message or block number: 404", readChatImage({ file, m: 99, b: 0 }).status === 404 && readChatImage({ file, m: 0, b: 9 }).status === 404);
  check("bad numbers: 400", [{ m: -1, b: 0 }, { m: "x", b: 0 }, { m: 1.5, b: 0 }, { m: 0, b: null }, { m: "1e3", b: 0 }, {}].every((q) => readChatImage({ file, ...q }).status === 400));
  check("numbers as text from a query string work", readChatImage({ file, m: "0", b: "0" }).ok === true);
  check("a file that is not a saved chat (wrong ending, missing, not a string) is refused", readChatImage({ file: join(tmp, "x.txt"), m: 0, b: 0 }).status === 400 && readChatImage({ file: join(tmp, "none.jsonl"), m: 0, b: 0 }).status === 404 && readChatImage({ file: 5, m: 0, b: 0 }).status === 400);
  check("size cap: a small maxBytes refuses (413)", readChatImage({ file, m: 0, b: 0, maxBytes: 10 }).status === 413);
  // oversize: 13 MB of PNG-looking data
  const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(13 * 1024 * 1024, 7)]);
  const fbig = join(tmp, "big.jsonl"); fs.writeFileSync(fbig, JSON.stringify(U(0, [img(big)])) + "\n");
  check("13 MB picture: 413 with the default cap of 12 MB", readChatImage({ file: fbig, m: 0, b: 0 }).status === 413);
  check("a bigger maxBytes cannot lift the 12 MB cap", readChatImage({ file: fbig, m: 0, b: 0, maxBytes: 99 * 1024 * 1024 }).status === 413);
  // 1 MB line performance (and a 10 MB chat of many lines)
  const mid = Buffer.concat([png, Buffer.alloc(1024 * 1024, 5)]);
  const many = []; for (let i = 0; i < 300; i++) many.push(JSON.stringify(i === 250 ? U(i, [img(mid)]) : U(i, "line " + i + " " + "x".repeat(2000))));
  const fm = join(tmp, "many.jsonl"); fs.writeFileSync(fm, many.join("\n") + "\n");
  let t0 = Date.now(); const pm = parseFile(fm); const tParse = Date.now() - t0;
  const pi = pm.messages[250].blocks[0];
  t0 = Date.now(); const rm = readChatImage({ file: fm, m: pi.m, b: pi.b }); const tRead = Date.now() - t0;
  check(`1 MB picture line in a 300-line chat: found and exact (parse ${tParse} ms, read ${tRead} ms)`, pi.type === "image" && rm.ok && rm.bytes.equals(mid) && tParse < 3000 && tRead < 3000);
  const feedJson = JSON.stringify(pm.messages[250]);
  check("the feed JSON never holds picture data", !feedJson.includes(png.toString("base64").slice(0, 16)) && feedJson.length < 400, feedJson);
  // the file changing under us (a live chat gets new lines): still finds the same picture
  fs.appendFileSync(fm, JSON.stringify(U(301, "new line")) + "\n");
  check("a chat that grew since: same picture, still exact", readChatImage({ file: fm, m: pi.m, b: pi.b }).ok === true);
  const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("// ---------- self-test")[0];
  check("module source writes nothing and starts no process", !/writeFile|appendFile|mkdirSync|rmSync|unlinkSync|renameSync|spawn|exec|fork\(/.test(src));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${ok}/${total}`);
  process.exit(ok === total ? 0 : 1);
}
