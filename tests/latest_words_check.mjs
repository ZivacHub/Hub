// Run with the dashboard up (node tools/dashboard/server.mjs):  node tests/latest_words_check.mjs
// Independent check of the dashboard's "Claude last said": read whole chat files line by line (not the 1.5 MB tail),
// skip side-chain (sub-agent) messages, and compare with /api/answers. Prints project, file, time, first 80 chars. Never prints keys.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const CHATS = join(homedir(), ".claude", "projects");
const enc = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const BUSNUS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const api = await (await fetch("http://127.0.0.1:4780/api/answers")).json();
const projects = await (await fetch("http://127.0.0.1:4780/api/projects")).json();

const folders = readdirSync(CHATS);
let bad = 0;
for (const p of projects.projects.filter((x) => x.setUp)) {
  const e = enc(join(BUSNUS, p.name));
  const files = [];
  for (const f of folders.filter((f) => f === e || f.startsWith(e + "-"))) {
    const dir = join(CHATS, f);
    for (const n of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) files.push({ file: join(dir, n), m: statSync(join(dir, n)).mtimeMs, n });
  }
  files.sort((a, b) => b.m - a.m);
  const shown = api.answers.find((a) => a.project === p.name);
  // independent: walk the newest files until one has a main-chain assistant text; take the LAST one by timestamp
  let truth = null, used = null;
  for (const f of files) {
    let last = null;
    for (const line of readFileSync(f.file, "utf8").split("\n")) {
      if (!line.includes('"type":"assistant"')) continue;
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.type !== "assistant" || j.isSidechain) continue;
      const t = (j.message?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
      if (t) last = { t, at: j.timestamp };
    }
    if (last && (!truth || last.at > truth.at)) { truth = last; used = f.n; }
  }
  const norm = (s) => String(s).replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const same = shown && truth && norm(truth.t).slice(0, 40) === norm(shown.short).slice(0, 40);
  if (!same) bad++;
  console.log(`\n${p.name}\n  chat files: ${files.length}, newest by file time: ${files[0] ? files[0].n.slice(0, 8) : "none"}, truth from: ${used ? used.slice(0, 8) : "none"}`);
  console.log(`  truth: ${truth ? truth.at + " | " + truth.t.replace(/\s+/g, " ").slice(0, 80) : "(no assistant text)"}`);
  console.log(`  page : ${shown ? shown.at + " | " + shown.short.slice(0, 80) : "(none shown)"}`);
  console.log(`  ${same ? "MATCH" : "DIFFERENT"}`);
}
console.log(`\n${bad} of ${projects.projects.filter((x) => x.setUp).length} projects differ`);
process.exit(bad ? 1 : 0);
