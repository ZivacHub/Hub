// Dashboard data (plan steps 3.1, 3.5, 3.6, 6.1, 6.4). READ-ONLY: every function only reads files or does a GET.
// Project numbers come from the same library `busnus-status` uses (via tools/hub_status/status.mjs), so they always match.
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(homedir(), ".claude", "hooks", "lib", "busnus.mjs")).href);
const { summarize } = await import(pathToFileURL(join(HERE, "..", "..", "hub_status", "status.mjs")).href);

const CHATS = join(homedir(), ".claude", "projects");
// the Hub starts the Manager on 18000; 8000 is its old default (and ClipForge's openshorts container uses 8000, so identity is checked below)
const MANAGER_URLS = process.env.HUB_MANAGER_URL ? [process.env.HUB_MANAGER_URL] : ["http://127.0.0.1:18000", "http://127.0.0.1:8000"];

// ---------- 6.4: nothing that looks like a secret is ever sent to the page ----------
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,                         // OpenAI / Anthropic style keys
  /\bAIza[0-9A-Za-z_-]{20,}/g,                        // Google API keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,                    // GitHub tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                  // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                            // AWS access key id
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g,                          // any long random-looking string
];
export function redact(text) {
  let s = String(text ?? "");
  for (const re of SECRET_PATTERNS) s = s.replace(re, "[hidden]");
  return s;
}

const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + "…" : s);
const plain = (s) => String(s).replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();

// ---------- cache so refreshing every 30 s does not rescan 16 projects each time ----------
const cache = new Map();
function cached(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}
async function cachedAsync(key, ms, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// one scan of all project folders, shared by every endpoint
const rows = () => cached("rows", 15000, () => lib.collectProjects());

// ---------- 3.1 projects ----------
export function projects() {
  return cached("projects", 15000, () => {
    const list = rows().map((r) => {
      const s = summarize(r);
      return {
        name: r.name, setUp: s.setUp, planning: s.planning, hasCode: s.hasCode,
        phase: s.currentPhase ? { number: s.currentPhaseNumber, title: s.currentPhase, of: s.phasesTotal } : null,
        phasesDone: s.phasesDone ?? null, phasesTotal: s.phasesTotal ?? null,
        stepsDone: s.stepsDone ?? null, stepsTotal: s.stepsTotal ?? null, percent: s.percent ?? null,
        nextStep: s.nextStep ?? null, decisionsWaiting: s.decisionsWaiting.length,
        handoffDaysOld: s.handoffDaysOld, lastCommit: r.last || null,
      };
    });
    return { generatedAt: new Date().toISOString(), projects: list };
  });
}

// ---------- 3.6 every waiting decision with its question ----------
function sectionOf(text, id) {
  const head = new RegExp(`^#{2,3}\\s+${id}\\b.*$`, "im").exec(text);
  if (!head) return "";
  const rest = text.slice(head.index + head[0].length);
  const next = /^#{2,3}\s/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
export function decisions() {
  return cached("decisions", 15000, () => {
    const out = [];
    for (const r of rows()) {
      const waiting = [...r.decisions.open, ...r.decisions.proposed];
      if (!waiting.length) continue;
      const text = lib.read(lib.docPath(r.root, "DECISIONS.md"));
      for (const d of waiting) {
        const body = sectionOf(text, d.id);
        const q = /\*\*Question:\*\*\s*(.+)/i.exec(body)?.[1] || body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("**Affects")) || "";
        out.push({ project: r.name, id: d.id, title: redact(d.title), status: d.status, question: redact(clip(plain(q), 320)) });
      }
    }
    return { generatedAt: new Date().toISOString(), decisions: out };
  });
}

// ---------- 6.1 Claude's latest words per project (reads saved chat files, read-only) ----------
const encode = (path) => path.replace(/[^A-Za-z0-9]/g, "-");
function tailLines(file, bytes = 1_500_000) {
  const size = statSync(file).size;
  const fd = openSync(file, "r");
  try {
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n");
    if (size > len) lines.shift(); // first line is probably cut
    return lines;
  } finally { closeSync(fd); }
}
function lastAssistant(file) {
  const lines = tailLines(file);
  let title = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let j; try { j = JSON.parse(lines[i]); } catch { continue; }
    if (!title && j.type === "custom-title") title = j.customTitle || j.title || null;
    if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      const text = j.message.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      if (text) return { text, at: j.timestamp || null, title };
    }
  }
  return null;
}
export function answers() {
  return cached("answers", 20000, () => {
    let folders = []; try { folders = readdirSync(CHATS); } catch {}
    const out = [];
    for (const r of rows()) {
      if (!r.hasClaudeMd) continue;
      const enc = encode(r.root);
      let best = null;
      for (const f of folders.filter((f) => f === enc || f.startsWith(enc + "-"))) {
        const dir = join(CHATS, f);
        let files = []; try { files = readdirSync(dir).filter((n) => n.endsWith(".jsonl")); } catch {}
        for (const n of files) {
          const m = statSync(join(dir, n)).mtimeMs;
          if (!best || m > best.m) best = { m, file: join(dir, n) };
        }
      }
      if (!best) continue;
      try {
        const a = lastAssistant(best.file);
        if (a) out.push({ project: r.name, at: a.at || new Date(best.m).toISOString(), chat: a.title ? redact(clip(a.title, 80)) : null,
          short: redact(clip(plain(a.text), 220)), long: redact(clip(plain(a.text), 1400)) });
      } catch { out.push({ project: r.name, at: new Date(best.m).toISOString(), chat: null, short: "Can't read this chat.", long: "" }); }
    }
    return { generatedAt: new Date().toISOString(), answers: out };
  });
}

// ---------- 3.5 the AI_Orcestration Manager (GET only, 1.5 s timeout) ----------
async function get(path, base) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(1500) });
  return { status: res.status, body: res.ok ? await res.json().catch(() => null) : null };
}
export function manager() {
  return cachedAsync("manager", 5000, async () => {
    for (const base of MANAGER_URLS) {
      try {
        const h = await get("/health", base);
        if (h.status === 401 || h.status === 403) return { running: true, url: base, note: "Running, but it asks for its key, so the Hub can't read it." };
        // only the real Manager reports a queue depth; anything else on this port is some other program
        if (!h.body || !("queue_depth" in h.body)) continue;
        // /health also counts finished and dead tasks in queue_depth; /status has the real breakdown
        const st = (await get("/status", base).catch(() => ({}))).body;
        const pending = st && st.queue ? Number(st.queue.PENDING || 0) : null;
        const goalText = st && st.goal && st.goal.description ? st.goal.description : null;
        return { running: true, url: base, queueDepth: pending ?? h.body.queue_depth ?? null, busy: !!(st && st.run_active),
          goal: goalText ? redact(clip(plain(goalText), 160)) : null, note: goalText ? null : "Running, no active goal." };
      } catch { /* try the next address */ }
    }
    return { running: false, note: "Manager not running." };
  });
}

export const exists = existsSync;
