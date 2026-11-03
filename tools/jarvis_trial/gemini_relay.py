"""Local relay between the isair/jarvis trial and Gemini's OpenAI-compatible endpoint (D12/D13).

Why: Jarvis's personality ("dry, witty, lightly sarcastic") is hard-coded and has no setting. Ivan wants a precise,
formal butler with no jokes. This relay rewrites only that persona paragraph in the system message and forwards
everything else unchanged (including streaming). It never stores the API key (Jarvis sends it in the Authorization
header, the relay passes it on) and never logs what was said: the log has time, path, model, status and seconds only.

Run:   python tools/jarvis_trial/gemini_relay.py [port=8787]
Point Jarvis's llm_base_url at http://127.0.0.1:<port>/v1beta/openai
Test:  python tools/jarvis_trial/gemini_relay.py --selftest
"""
import http.client
import json
import os
import re
import ssl
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = "generativelanguage.googleapis.com"
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "relay_log.jsonl")
_lock = threading.Lock()

PERSONA_RE = re.compile(
    r"Persona: you are a British butler named (\w+).*?Never stack multiple jokes in one reply\. ", re.DOTALL)

NEW_PERSONA = (
    "Persona: you are a British butler named {name}: formal, courteous, exact and composed. "
    "Speak like a seasoned, real butler: plain, correct, unhurried. "
    "No jokes, no wit, no sarcasm, no puns, no asides, no teasing, no remarks about the situation "
    "and no commentary about yourself. "
    "Answer the question directly and precisely in as few words as are correct, then stop. "
    "Never pad the answer and never add anything that was not asked for. "
    "If you do not know, or a tool failed, say so plainly in one sentence. "
    "You may address the user as 'sir', at most once per reply and only when it sounds natural. "
    "Never open with 'Ah,' / 'Very good' / 'Certainly' or any other theatrical filler, "
    "and never be sycophantic ('great question', 'I'd be happy to'). "
    "Tool rules (hard): for any question about the progress, phase, step, percentage or waiting decisions of a project, "
    "or about which projects exist, use the hub__ tools: they are instant and exact. Use claude__ask_claude ONLY when the user "
    "explicitly says to ask Claude, or when the question needs real reading of notes that the hub__ tools cannot give; never "
    "for simple status. Only talk about the project the user NAMES: never assume it is the project or chat Ivan is working on "
    "right now, and if no project was named and one is needed, ask which one. "
)


def rewrite_text(text):
    """Return (new_text, changed)."""
    new, n = PERSONA_RE.subn(lambda m: NEW_PERSONA.format(name=m.group(1)), text, count=1)
    return new, bool(n)


def rewrite_body(body):
    """Rewrite the persona in system messages of a chat request. Returns (body, changed)."""
    changed = False
    for msg in body.get("messages", []):
        if msg.get("role") != "system":
            continue
        c = msg.get("content")
        if isinstance(c, str):
            msg["content"], ch = rewrite_text(c)
            changed |= ch
        elif isinstance(c, list):
            for part in c:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    part["text"], ch = rewrite_text(part["text"])
                    changed |= ch
    return body, changed


SPEAK_URL = None  # set with --speak http://127.0.0.1:8788 : replies are also sent to the Daniel speaker service


def extract_reply(buf, ctype):
    """Return (reply text, names of tools the model asked for) from a chat-completions response (JSON or event stream)."""
    text, tools = "", []
    raw = buf.decode("utf-8", errors="replace")
    pieces = []
    if "event-stream" in ctype:
        for line in raw.splitlines():
            if line.startswith("data:") and line[5:].strip() not in ("", "[DONE]"):
                try:
                    pieces.append(json.loads(line[5:].strip()))
                except ValueError:
                    pass
    else:
        try:
            j = json.loads(raw)
            pieces = j if isinstance(j, list) else [j]
        except ValueError:
            pass
    for j in pieces:
        for ch in j.get("choices", []):
            d = ch.get("delta") or ch.get("message") or {}
            text += d.get("content") or ""
            for tc in d.get("tool_calls") or []:
                tools.append((tc.get("function") or {}).get("name"))
    return text, tools


def _post(path, payload=None):
    import urllib.request
    body = json.dumps(payload or {}).encode()
    urllib.request.urlopen(urllib.request.Request(SPEAK_URL + path, body, {"Content-Type": "application/json"}), timeout=5).read()


def speak_from_response(buf, ctype):
    try:
        text, tools = extract_reply(buf, ctype)
        if "stop" in tools:
            _post("/stop")
        elif text.strip() and not tools:
            _post("/say", {"text": text})
    except Exception:
        pass  # the speaker being down must never break Jarvis


# Jarvis's built-in tools that Ivan's rules do not allow: localFiles can read, write, append and DELETE any file in the
# home folder without asking; screenshot would send screen text to Google; the meal tools are irrelevant. The relay removes
# them from every request, so the model never sees them (Jarvis has no setting to turn them off).
DENY_TOOLS = {"localFiles", "screenshot", "logMeal", "fetchMeals", "deleteMeal"}


def strip_tools(body):
    """Remove denied tools from a chat request. Returns how many were removed."""
    tools = body.get("tools")
    if not isinstance(tools, list):
        return 0
    kept = [t for t in tools if (t.get("function") or {}).get("name") not in DENY_TOOLS]
    removed = len(tools) - len(kept)
    if removed:
        if kept:
            body["tools"] = kept
        else:
            body.pop("tools", None)
            body.pop("tool_choice", None)
    return removed


def log(entry):
    with _lock, open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"  # body ends when the connection closes: simplest way to pass streams through

    def log_message(self, *a):
        pass

    def _forward(self):
        t0 = time.time()
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        changed, model, stripped = None, None, 0
        if raw and self.path.endswith("/chat/completions"):
            try:
                body = json.loads(raw)
                model = body.get("model")
                body, changed = rewrite_body(body)
                stripped = strip_tools(body)
                raw = json.dumps(body).encode()
            except Exception:
                changed = None
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "content-length", "accept-encoding", "connection")}
        headers["Accept-Encoding"] = "identity"
        if raw:
            headers["Content-Length"] = str(len(raw))
        status = 0
        try:
            conn = http.client.HTTPSConnection(UPSTREAM, timeout=120, context=ssl.create_default_context())
            conn.request(self.command, self.path, body=raw or None, headers=headers)
            r = conn.getresponse()
            status = r.status
            self.send_response(r.status)
            for k, v in r.getheaders():
                if k.lower() not in ("transfer-encoding", "content-length", "connection", "content-encoding"):
                    self.send_header(k, v)
            self.end_headers()
            ctype = r.getheader("Content-Type", "")
            buf = bytearray()
            while True:
                chunk = r.read(2048)
                if not chunk:
                    break
                buf.extend(chunk)
                self.wfile.write(chunk)
                self.wfile.flush()
            if SPEAK_URL and changed and status == 200:
                threading.Thread(target=speak_from_response, args=(bytes(buf), ctype), daemon=True).start()
        except Exception as e:  # report upstream trouble to Jarvis as a gateway error, never print secrets
            if not status:
                self.send_error(502, "relay: " + type(e).__name__)
            status = status or 502
        log(dict(t=time.strftime("%F %T"), method=self.command, path=self.path.split("?")[0], model=model,
                 persona_rewritten=changed, tools_removed=stripped, status=status, seconds=round(time.time() - t0, 2)))

    do_GET = do_POST = do_PUT = do_DELETE = _forward


def selftest():
    sys.path.insert(0, os.path.join(HERE, ".."))
    import urllib.request
    src = urllib.request.urlopen(
        "https://raw.githubusercontent.com/isair/jarvis/main/src/jarvis/system_prompt.py", timeout=30).read().decode()
    ns = {}
    exec(src, ns)
    prompt = ns["build_system_prompt"]("Jarvis")
    new, ok = rewrite_text(prompt + " [Context: Monday 12:00, Zagreb]")
    assert ok, "persona paragraph not found in Jarvis's current prompt"
    assert "witty" not in new and "No jokes" in new and "[Context:" in new and "Always respond in a short" in new
    print("selftest OK: persona replaced, context line and formatting rules kept;", len(prompt), "->", len(new), "chars")
    # reply extraction: plain JSON, event stream, and a tool call
    t, tools = extract_reply(json.dumps({"choices": [{"message": {"content": "Four."}}]}).encode(), "application/json")
    assert (t, tools) == ("Four.", [])
    sse = b'data: {"choices":[{"delta":{"content":"Two plus "}}]}\n\ndata: {"choices":[{"delta":{"content":"two."}}]}\n\ndata: [DONE]\n\n'
    assert extract_reply(sse, "text/event-stream") == ("Two plus two.", [])
    tc = json.dumps({"choices": [{"message": {"content": None, "tool_calls": [{"function": {"name": "stop"}}]}}]}).encode()
    assert extract_reply(tc, "application/json") == ("", ["stop"])
    print("selftest OK: reply extraction (json, stream, tool call)")
    fn = lambda n: {"type": "function", "function": {"name": n}}
    b = {"tools": [fn("localFiles"), fn("webSearch"), fn("screenshot"), fn("hub__project_status"), fn("deleteMeal")], "tool_choice": "auto"}
    assert strip_tools(b) == 3 and [t["function"]["name"] for t in b["tools"]] == ["webSearch", "hub__project_status"]
    b = {"tools": [fn("localFiles")], "tool_choice": "auto"}
    assert strip_tools(b) == 1 and "tools" not in b and "tool_choice" not in b
    print("selftest OK: dangerous tools removed (localFiles, screenshot, meal tools), others kept")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        args = [a for a in sys.argv[1:]]
        if "--speak" in args:
            i = args.index("--speak")
            SPEAK_URL = args[i + 1]
            del args[i:i + 2]
        port = int(args[0]) if args else 8787
        ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
