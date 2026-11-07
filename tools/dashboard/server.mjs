// Hub dashboard server (plan steps 3.1 and 3.3). Plain Node, no dependencies, READ-ONLY, this PC only.
//   node tools/dashboard/server.mjs           real data from this PC's projects  -> http://127.0.0.1:4780
//   node tools/dashboard/server.mjs --demo    made-up sample data (for screenshots, safe to show to anyone)
//   node tools/dashboard/server.mjs --selftest  start on a spare port and check the safety rules
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const args = process.argv.slice(2);
const DEMO = args.includes("--demo");
const SELFTEST = args.includes("--selftest");
const PORT = SELFTEST ? 0 : Number(process.env.HUB_PORT || 4780);
const HOST = "127.0.0.1"; // never 0.0.0.0: nothing outside this PC can reach the page (D8)

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const HEADERS = {
  "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
};

const real = DEMO ? null : await import("./lib/data.mjs");
const sample = DEMO ? JSON.parse(readFileSync(join(HERE, "demo", "sample.json"), "utf8")) : null;
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const demoProjects = () => ({ generatedAt: new Date().toISOString(), demo: true, projects: sample.projects });

const api = {
  "/api/projects": () => (DEMO ? demoProjects() : real.projects()),
  "/api/decisions": () => (DEMO ? { generatedAt: new Date().toISOString(), decisions: sample.decisions } : real.decisions()),
  "/api/answers": () => (DEMO ? { generatedAt: new Date().toISOString(), answers: sample.answers.map((a) => ({ ...a, at: ago(a.agoMinutes) })) } : real.answers()),
  "/api/manager": () => (DEMO ? sample.manager : real.manager()),
};

const hostOk = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(h || ""); // blocks DNS-rebinding tricks

const server = createServer(async (req, res) => {
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "Content-Type": type, ...HEADERS }); res.end(body); };
  try {
    if (!hostOk(req.headers.host)) return send(403, '{"error":"forbidden"}');
    if (req.method !== "GET" && req.method !== "HEAD") return send(405, '{"error":"read only"}');
    const path = new URL(req.url, "http://x").pathname;
    if (api[path]) return send(200, JSON.stringify(await api[path]()));
    const rel = path === "/" ? "index.html" : normalize(decodeURIComponent(path)).replace(/^[/\\]+/, "");
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + sep) || !existsSync(file) || !statSync(file).isFile()) return send(404, '{"error":"not found"}');
    send(200, readFileSync(file), TYPES[extname(file)] || "application/octet-stream");
  } catch (e) {
    send(500, '{"error":"could not read the project files"}');
  }
});

server.on("error", (e) => {
  console.error(e.code === "EADDRINUSE" ? `Port ${PORT} is already in use. The dashboard may already be running: open http://${HOST}:${PORT}` : `Could not start: ${e.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  const port = server.address().port;
  if (!SELFTEST) {
    console.log(`Hub dashboard${DEMO ? " (sample data)" : ""}: http://${HOST}:${port}`);
    // read every project once now so the first page load is quick, then (with --open) open the browser: it never opens to a dead page
    try { if (!DEMO) { console.log("Reading your projects..."); await Promise.all([real.projects(), real.decisions(), real.answers(), real.manager()]); } } catch { /* the page shows its own error */ }
    if (args.includes("--open") && process.platform === "win32") spawn("cmd", ["/c", "start", "", `http://${HOST}:${port}`], { stdio: "ignore", detached: true }).unref();
    console.log("Ready.");
    return;
  }
  const base = `http://${HOST}:${port}`;
  const ok = (name, cond) => { console.log(`${cond ? "OK  " : "FAIL"} ${name}`); if (!cond) process.exitCode = 1; };
  const r1 = await fetch(base + "/api/projects"); const j = await r1.json();
  ok("GET /api/projects returns projects", r1.status === 200 && Array.isArray(j.projects) && j.projects.length > 0);
  ok("GET / serves the page", (await fetch(base + "/")).status === 200);
  ok("POST is refused", (await fetch(base + "/api/projects", { method: "POST" })).status === 405);
  ok("path tricks refused", (await fetch(base + "/..%2f..%2fserver.mjs")).status === 404);
  ok("foreign Host header refused", await new Promise((resolve) => {
    import("node:http").then(({ request }) => request({ host: HOST, port, path: "/api/projects", headers: { Host: "evil.example" } }, (r) => resolve(r.statusCode === 403)).end());
  }));
  server.close();
});
