"""Claude hand-off for Jarvis (D13): a tiny MCP server (stdio) with ONE read-only tool, `ask_claude`.

Jarvis lists it under "mcps" in its config; when Ivan says "ask Claude ...", Jarvis calls the tool, this program runs
`claude -p` (Claude Code's one-shot mode, his own login) in an empty scratch folder with ONLY the read tools
(Read, Grep, Glob) and read access to the BUSNUS projects folder, and returns a short plain-text answer to be spoken.
It cannot run commands, edit, write, browse, send or post anything. Every call is logged locally (bridge_log.jsonl,
git-ignored). Writing or sending later needs its own tool with a read-back and a spoken yes (not built).

No dependencies: hand-written MCP over newline-delimited JSON-RPC.
  python tools/claude_bridge/server.py              run as MCP server
  python tools/claude_bridge/server.py --selftest   protocol test with a stand-in answer (no Claude call)
  CLAUDE_BRIDGE_STUB=1 makes ask_claude return a canned sentence instead of calling Claude.
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "bridge_log.jsonl")
CWD = r"C:\Users\Ivan\JarvisTrial\claude_cwd"            # empty scratch folder: no project files, no CLAUDE.md
READ_ROOT = r"C:\Users\Ivan\Desktop\BUSNUS"               # the only place Claude may read
CLAUDE = r"C:\Users\Ivan\.local\bin\claude.exe"
TIMEOUT_S = 120
MAX_Q, MAX_A = 1000, 900

SYSTEM = (
    "You are answering for a voice assistant that will speak your reply aloud. Reply in at most three short spoken "
    "sentences, plain text, no markdown, no lists, no file paths read out letter by letter. You may only read files. "
    "Never read .env files, key files or credentials, and never repeat secrets. If you are unsure, say so in one sentence."
)

TOOL = {
    "name": "ask_claude",
    "description": (
        "Ask Claude a question that needs real reading or reasoning, for example about Ivan's BUSNUS projects "
        "(plan boards, decisions, handoffs, notes). Read-only: it cannot change, send, post or delete anything. "
        "Use it when the question is too big for a quick answer. Returns a short spoken-style answer."),
    "inputSchema": {
        "type": "object",
        "properties": {"question": {"type": "string", "description": "The question, in one or two plain sentences."}},
        "required": ["question"],
    },
}


def log(entry):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def ask_claude(question):
    t0 = time.time()
    question = (question or "").strip()
    if not question:
        return "No question was given.", False
    if len(question) > MAX_Q:
        return "The question is too long for me to pass on.", False
    if os.environ.get("CLAUDE_BRIDGE_STUB"):
        return "Stand-in answer: the bridge works, Claude was not called.", True
    os.makedirs(CWD, exist_ok=True)
    cmd = [CLAUDE, "-p", question, "--output-format", "json", "--no-session-persistence",
           "--allowedTools", "Read", "Grep", "Glob",
           "--disallowedTools", "Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch",
           "--add-dir", READ_ROOT, "--max-budget-usd", "0.50", "--append-system-prompt", SYSTEM]
    ok, text = False, "Claude could not be reached."
    try:
        p = subprocess.run(cmd, cwd=CWD, capture_output=True, text=True, timeout=TIMEOUT_S, encoding="utf-8",
                           stdin=subprocess.DEVNULL)
        try:
            j = json.loads(p.stdout)
            if j.get("is_error"):
                text = "Claude reported an error: " + str(j.get("result", ""))[:200]
            else:
                text, ok = str(j.get("result", "")).strip() or "Claude gave an empty answer.", True
        except ValueError:
            text = "Claude returned something I could not read."
    except subprocess.TimeoutExpired:
        text = "Claude took too long, so I stopped waiting."
    except Exception as e:
        text = "Claude could not be started: " + type(e).__name__
    log(dict(t=time.strftime("%F %T"), seconds=round(time.time() - t0, 1), ok=ok, question=question[:300],
             answer_chars=len(text)))
    return text[:MAX_A], ok


def reply(msg_id, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": msg_id}
    if error:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        ver = (msg.get("params") or {}).get("protocolVersion", "2024-11-05")
        reply(mid, {"protocolVersion": ver, "capabilities": {"tools": {}},
                    "serverInfo": {"name": "claude-bridge", "version": "0.1.0"}})
    elif method == "tools/list":
        reply(mid, {"tools": [TOOL]})
    elif method == "tools/call":
        params = msg.get("params") or {}
        if params.get("name") != "ask_claude":
            reply(mid, error={"code": -32602, "message": "unknown tool"})
            return
        text, ok = ask_claude((params.get("arguments") or {}).get("question"))
        reply(mid, {"content": [{"type": "text", "text": text}], "isError": not ok})
    elif method == "ping":
        reply(mid, {})
    elif mid is not None:  # unknown request
        reply(mid, error={"code": -32601, "message": "method not found"})
    # notifications (no id), e.g. notifications/initialized: nothing to do


def serve():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            handle(json.loads(line))
        except Exception as e:  # never crash the stream
            sys.stderr.write("bridge error: " + type(e).__name__ + "\n")


def selftest():
    env = dict(os.environ, CLAUDE_BRIDGE_STUB="1")
    p = subprocess.Popen([sys.executable, os.path.abspath(__file__)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         text=True, env=env)

    def rpc(obj):
        p.stdin.write(json.dumps(obj) + "\n")
        p.stdin.flush()
        return json.loads(p.stdout.readline()) if "id" in obj else None

    r = rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
    assert r["result"]["protocolVersion"] == "2025-03-26" and "tools" in r["result"]["capabilities"]
    rpc({"jsonrpc": "2.0", "method": "notifications/initialized"})
    r = rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert [t["name"] for t in r["result"]["tools"]] == ["ask_claude"]
    r = rpc({"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "ask_claude", "arguments": {"question": "How far is Hub?"}}})
    assert r["result"]["isError"] is False and "Stand-in" in r["result"]["content"][0]["text"], r
    r = rpc({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "delete_everything", "arguments": {}}})
    assert "error" in r
    r = rpc({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "ask_claude", "arguments": {"question": "x" * 2000}}})
    assert r["result"]["isError"] is True
    p.stdin.close()
    p.wait(timeout=10)
    print("selftest OK: initialize, tools/list (1 read-only tool), call, unknown tool refused, long question refused")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        serve()
