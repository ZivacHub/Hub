// Self-test of the Hub app (step 16.1). Plain Node:  node tools/app/selftest.mjs   (or `npm run selftest` in tools/app)
// 1. checks the pure rules (port, server flags, Hub origin, claude:// allow-list) without opening anything;
// 2. starts the real app (electron.exe) in self-test mode on port 4792 with sample data (--demo) and reads its OK/FAIL lines;
// 2b. (16.2) when the app says READY_FOR_SECOND_INSTANCE this runner starts a second electron.exe with the same profile and checks
//     it exits by itself within a few seconds while the first one shows its window again;
// 3. checks afterwards that the app exited with 0, the sample dashboard it started is gone, and no Electron process was left behind.
// A Hub window shows briefly (sample data only). It never touches the real dashboard on 4780 and never opens a real chat.
// Optional: HUB_APP_SHOT=<path.png> saves one screenshot of the window. Exit code 0 = everything passed.
import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAllowedChatLink, isHubOrigin, isOtherLocalPortLink, parsePort, parseServerArgs } from "./lib/rules.mjs";
import { buildTrayTemplate } from "./lib/traymenu.mjs";
import { pageAnswers } from "./lib/server.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = join(HERE, "node_modules", "electron", "dist", "electron.exe");
const PORT = 4792;
const EXPECTED_APP_CHECKS = 59; // OK lines the app prints when every check runs (screenshot line only with HUB_APP_SHOT)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else fail++; console.log(`${cond ? "OK" : "FAIL"} ${name}`); };

// ---------- 1. pure rules
ok("rules: HUB_PORT default 4780, '4792' -> 4792, junk refused", parsePort(undefined) === 4780 && parsePort("") === 4780 && parsePort("4792") === 4792 && parsePort("0") === null && parsePort("70000") === null && parsePort("4780; calc") === null && parsePort("-1") === null);
ok("rules: HUB_APP_ARGS keeps --demo/--boot/--demo-x=y, drops --open, --selftest and non-flags", JSON.stringify(parseServerArgs(" --demo  --boot --demo-chats=empty --open --selftest x & calc --a=b;c ")) === JSON.stringify(["--demo", "--boot", "--demo-chats=empty"]) && parseServerArgs(undefined).length === 0);
ok("rules: Hub origin is exactly http://127.0.0.1:PORT", isHubOrigin("http://127.0.0.1:4792/helpers.html", 4792) && !isHubOrigin("http://localhost:4792/", 4792) && !isHubOrigin("http://127.0.0.1:4780/", 4792) && !isHubOrigin("https://127.0.0.1:4792/", 4792) && !isHubOrigin("http://127.0.0.1.evil.com:4792/", 4792) && !isHubOrigin("not a url", 4792));
ok("rules: the three claude:// chat links are allowed", ["claude://claude.ai/epitaxy/local_abc", "claude://code/new?q=Hi&folder=C%3A%5Cx", "claude://resume?session=0000"].every(isAllowedChatLink));
ok("rules: everything else is refused", ["claude://evil/", "claude://claude.ai/epitaxy/remote_x", "claude://claude.ai/epitaxy/local_", "claude://code/new", "claude://code/newx?", "claude://resume?sessionX=1", "CLAUDE://code/new?x", "file:///C:/x", "https://claude.ai/", "claude://code/new?q=a b", "claude://code/new?q=\"x", "claude://code/new?" + "a".repeat(5000), null, 5].every((u) => !isAllowedChatLink(u)));

ok("rules: another local port (127.0.0.1 or localhost, http, 1024-65535, not the Hub's) goes to the browser", ["http://127.0.0.1:5057/", "http://localhost:5058/x?y=1", "http://127.0.0.1:65535/", "http://127.0.0.1:1024/"].every((u) => isOtherLocalPortLink(u, 4780)));
ok("rules: the Hub's own port, wrong scheme, low or missing port, credentials, other hosts are not 'other local port' links", ["http://127.0.0.1:4780/", "http://localhost:4780/", "https://127.0.0.1:1234/", "http://127.0.0.1:80/", "http://127.0.0.1/", "http://127.0.0.1:1023/", "http://127.0.0.1:65536/", "http://user@127.0.0.1:5000/", "http://user:pw@localhost:5000/", "http://example.com/", "http://example.com:5000/", "http://127.0.0.1.evil.com:5000/", "http://0.0.0.0:5000/", "claude://code/new?x", "javascript:alert(1)", "nonsense", null, 5].every((u) => !isOtherLocalPortLink(u, 4780)));
{
  const calls = [];
  const plain = buildTrayTemplate({ onOpen: () => calls.push("open"), onQuit: () => calls.push("quit") });
  plain[0].click(); plain[2].click();
  ok("tray menu: exactly 'Open Hub', separator, 'Quit Hub'; the items call the open and quit handlers", plain.length === 3 && plain[0].label === "Open Hub" && plain[1].type === "separator" && plain[2].label === "Quit Hub" && calls.join() === "open,quit");
  const withExtras = buildTrayTemplate({ onOpen() {}, onQuit() {}, extras: [{ label: "A" }, { label: "B" }] });
  ok("tray menu: extras (16.3) sit between Open Hub and Quit Hub", withExtras.map((i) => i.label || i.type).join() === "Open Hub,separator,A,B,separator,Quit Hub");
}

// ---------- 2. the real app, self-test mode
const electronPids = () => {
  try { return new Set(execFileSync("tasklist", ["/FI", "IMAGENAME eq electron.exe", "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/).map((l) => l.split('","')[1]).filter((p) => /^\d+$/.test(p || ""))); } catch { return new Set(); }
};
const pidAlive = (pid) => {
  try { return execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }).includes(`"${pid}"`); } catch { return false; }
};

if (!existsSync(ELECTRON)) {
  ok("Electron is installed (run npm install in tools/app, then node node_modules/electron/install.js)", false);
} else if (await pageAnswers(PORT)) {
  ok(`port ${PORT} is free before the test (something already answers there; stop it first)`, false);
} else {
  const before = electronPids();
  const env = { ...process.env, HUB_APP_SELFTEST: "1", HUB_PORT: String(PORT), HUB_APP_ARGS: "--demo" };
  delete env.ELECTRON_RUN_AS_NODE; delete env.HUB_APP_DEVTOOLS;
  const child = spawn(ELECTRON, [HERE], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
  let out = "";
  let shown = 0; // echo the app's lines as they come, whole lines only
  const echo = (flush) => { const parts = out.slice(shown).split(/\r?\n/); const ready = flush ? parts : parts.slice(0, -1); for (const l of ready) if (l.trim()) console.log(`  app: ${l}`); shown = flush ? out.length : out.length - parts[parts.length - 1].length; };
  let second = null; // the second start: { code, ms }
  const startSecond = () => {
    if (second) return; second = { code: undefined, ms: null, pending: true };
    const t0 = Date.now();
    const c2 = spawn(ELECTRON, [HERE], { env, stdio: "ignore", windowsHide: true });
    const kill = setTimeout(() => { try { c2.kill(); } catch { /* gone */ } }, 15000);
    c2.on("exit", (c) => { clearTimeout(kill); second.code = c; second.ms = Date.now() - t0; second.pending = false; });
  };
  child.stdout.on("data", (d) => { out += d; if (out.includes("READY_FOR_SECOND_INSTANCE")) startSecond(); echo(false); });
  child.stderr.on("data", (d) => { out += d; });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve("timeout"); }, 120000);
    child.on("exit", (c) => { clearTimeout(t); resolve(c); });
  });
  await sleep(100); echo(true);
  const lines = out.split(/\r?\n/);
  const appOk = lines.filter((l) => l.startsWith("OK ")).length, appFail = lines.filter((l) => l.startsWith("FAIL ")).length;
  const done = lines.find((l) => l.startsWith("SELFTEST DONE"));
  const want = EXPECTED_APP_CHECKS + (process.env.HUB_APP_SHOT ? 1 : 0);
  ok(`the app ran its checks: ${appOk} OK, ${appFail} FAIL (expected ${want} OK, 0 FAIL)`, appOk === want && appFail === 0 && done === `SELFTEST DONE pass=${appOk} fail=0`);
  ok("the app exited by itself with code 0", code === 0);
  ok(`a second start of the Hub exited by itself with code 0 within 10 s (${second?.ms ?? "never ran"} ms) and the first one reported it`, !!second && second.pending === false && second.code === 0 && second.ms < 10000 && lines.includes("SECOND_INSTANCE shown"));
  const serverPid = Number((lines.find((l) => l.startsWith("SERVER_PID ")) || "").slice(11)) || null;
  let left = true;
  for (let i = 0; i < 20 && left; i++) { left = (await pageAnswers(PORT, { timeoutMs: 500 })) || (serverPid !== null && pidAlive(serverPid)); if (left) await sleep(250); }
  ok(`the sample dashboard the app started (pid ${serverPid}) is gone and port ${PORT} no longer answers`, serverPid !== null && !left);
  let extra = [];
  for (let i = 0; i < 20; i++) { extra = [...electronPids()].filter((p) => !before.has(p)); if (!extra.length) break; await sleep(250); }
  ok("no Electron process was left behind", extra.length === 0);
  if (extra.length) console.log(`  left behind: electron pids ${extra.join(", ")}`);
}

console.log(`${fail ? "FAIL" : "PASS"}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
