// Hub status helper for Jarvis (plan Phase 2): a tiny MCP server (stdio, no dependencies) with three READ-ONLY tools.
// Jarvis lists it under "mcps" in its config. Nothing here can change a file: it only reads each project's plan board,
// decisions list and handoff metadata through Ivan's existing library, and returns sentences built by code.
//   node tools/hub_status/server.mjs              run as MCP server
//   node tools/hub_status/server.mjs --selftest   protocol test + numbers compared with `busnus-status`
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { allProjects, findProject, listSpoken, decisionsSpoken } from "./status.mjs";

const TOOLS = [
  {
    name: "list_projects",
    description: "List all of Ivan's BUSNUS projects with their progress. Use for 'which projects do I have?' or 'how are my projects doing?'. Read-only.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "project_status",
    description: "How far one project is: current phase, steps done, percent, next step, decisions waiting, handoff age. Use for 'how is ClipForge going?', 'what percentage are we on in the game project?'. Read-only. The nickname ClipForge is understood.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "Project name or nickname as the user said it." } }, required: ["project"] },
  },
  {
    name: "decisions_waiting",
    description: "Decisions that are waiting on Ivan, for one project or for all projects ('all'). Use for 'are any decisions waiting on me?'. Read-only.",
    inputSchema: { type: "object", properties: { project: { type: "string", description: "The project the user named, exactly as said. Use 'all' only when the user named no project." } } },
  },
];

function call(name, args) {
  if (name === "list_projects") return listSpoken();
  if (name === "project_status") { const f = findProject(args.project); return f.error || f.project.spoken; }
  if (name === "decisions_waiting") return decisionsSpoken(args.project);
  throw new Error("unknown tool");
}

function reply(id, result, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error } : { result }) }) + "\n");
}

function handle(msg) {
  const { method, id } = msg;
  if (method === "initialize") reply(id, { protocolVersion: msg.params?.protocolVersion || "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "hub-status", version: "0.1.0" } });
  else if (method === "tools/list") reply(id, { tools: TOOLS });
  else if (method === "tools/call") {
    try {
      const text = call(msg.params?.name, msg.params?.arguments || {});
      reply(id, { content: [{ type: "text", text: String(text).slice(0, 1500) }], isError: false });
    } catch (e) {
      if (String(e.message) === "unknown tool") reply(id, null, { code: -32602, message: "unknown tool" });
      else reply(id, { content: [{ type: "text", text: "Reading the project files failed." }], isError: true });
    }
  } else if (method === "ping") reply(id, {});
  else if (id !== undefined) reply(id, null, { code: -32601, message: "method not found" });
}

function selftest() {
  // 1) numbers match busnus-status (same library, but compared on its printed table so a parsing slip shows up)
  const table = spawnSync(process.execPath, [join(homedir(), ".claude", "hooks", "busnus-status.mjs")], { encoding: "utf8" }).stdout;
  const rows = allProjects();
  let checked = 0;
  for (const line of table.split("\n")) {
    const name = line.slice(0, 26).trim();
    const r = rows.find((x) => x.name === name);
    if (!r) continue;
    const planCol = line.slice(68, 86).trim();
    const waitCol = line.slice(86, 95).trim();
    if (r.setUp) {
      const want = `${r.phasesDone}/${r.phasesTotal} phases`;
      if (planCol !== want) throw new Error(`${name}: plan column "${planCol}" != "${want}"`);
    }
    const waiting = r.decisionsWaiting.length;
    if ((waitCol === "-" ? 0 : Number(waitCol)) !== waiting) throw new Error(`${name}: waiting "${waitCol}" != ${waiting}`);
    checked++;
  }
  if (checked < 5) throw new Error("compared too few projects: " + checked);
  console.log(`selftest OK 1/3: ${checked} projects match busnus-status (phases done and decisions waiting)`);
  // 2) nicknames and unknown names
  if (findProject("ClipForge").project?.name !== "Socials Automatisation") throw new Error("ClipForge nickname");
  if (!findProject("casino").error) throw new Error("ambiguous name should ask");
  if (!findProject("zzzz").error) throw new Error("unknown name should be refused");
  console.log("selftest OK 2/3: nickname ClipForge, ambiguous 'casino' asks, unknown refused");
  // 3) protocol
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "project_status", arguments: { project: "ClipForge" } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "delete_project", arguments: {} } },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const res = spawnSync(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { input, encoding: "utf8" });
  const out = res.stdout.trim().split("\n").map((l) => JSON.parse(l));
  if (out.length !== 4) throw new Error("expected 4 replies, got " + out.length);
  if (out[1].result.tools.length !== 3) throw new Error("expected 3 tools");
  if (!/Socials Automatisation is on phase/.test(out[2].result.content[0].text)) throw new Error("project_status text");
  if (!out[3].error) throw new Error("unknown tool must be refused");
  console.log("selftest OK 3/3: initialize, 3 read-only tools, call works, unknown tool refused");
}

if (process.argv.includes("--selftest")) selftest();
else createInterface({ input: process.stdin }).on("line", (line) => { if (line.trim()) { try { handle(JSON.parse(line)); } catch { /* ignore bad lines */ } } });
