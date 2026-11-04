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
import random
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

FIRST_BYTE_S = float(os.environ.get("RELAY_FIRST_BYTE_S", "5"))  # give up on a model that has not started answering
BACKUP_MODELS = [m for m in os.environ.get("RELAY_BACKUP_MODELS", "gemini-3.1-flash-lite").split(",") if m]
SKIP_S = 120  # a model that stalled or was overloaded is tried last for this long
LAST_TIMEOUT_S = 30  # the last model in line gets this long in total to answer; after that Jarvis gets an error, not a late answer
STALE_S = 40  # a reply that took longer than this is never spoken: Ivan has moved on (Jarvis's own timeout is set to match)
RETRY_STATUS = (429, 500, 502, 503, 504)
_bad_until = {}


def mark_bad(m):
    _bad_until[m] = time.time() + SKIP_S


def model_order(model):
    """The asked-for model first, then the backups; models that failed recently go to the back."""
    order = [model] + [m for m in BACKUP_MODELS if m != model]
    now = time.time()
    return [m for m in order if _bad_until.get(m, 0) <= now] + [m for m in order if _bad_until.get(m, 0) > now]


PERSONA_RE = re.compile(
    r"Persona: you are a British butler named (\w+).*?Never stack multiple jokes in one reply\. ", re.DOTALL)

NEW_PERSONA = (
    "Persona: you are a British butler named {name}: formal, courteous, exact and composed, with a very dry sense of "
    "humour that you ration. Speak like a seasoned, real butler: plain, correct, unhurried. "
    "The answer always comes first, complete and exact; wit never changes, hides or delays it. "
    "No jokes inside the answer, none about facts, numbers or Ivan's work, no puns, no teasing about mistakes, "
    "no commentary about yourself. "
    "Answer the question directly and precisely in as few words as are correct. "
    "Never pad the answer and never add anything that was not asked for, except the one allowed remark described below. "
    "Answer ONLY Ivan's most recent message. Earlier messages in this conversation that were never answered are stale: "
    "never answer them now unless he asks them again. "
    "Only when Ivan asks the SAME question again, nearly word for word, that you already answered earlier in this "
    "conversation, you may say so first in one short dry line (for example 'Again, sir? The answer has not changed.') and "
    "then give the answer again. A different question, a follow-up or a request to change your style is never a repeat. "
    "Never state in a remark any fact you cannot see in this conversation (time of day, weather, what Ivan is doing). "
    "Goodbye rule: when Ivan says goodnight, goodbye or that he is leaving, do NOT use the stop tool: answer with one short, "
    "courteous farewell. Use the stop tool only when he asks you to stop, be quiet, shut up or stop listening. "
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


BANTER_PCT = float(os.environ.get("RELAY_BANTER", "30"))  # how often (percent of replies) a dry remark is allowed
BANTER_ON = (
    "For THIS reply only: after the complete, exact answer you may add ONE short dry remark of at most twelve words: "
    "deadpan, understated, a little sarcastic, aimed at the situation or gently at Ivan, never cruel and never about the facts. "
    "If you cannot think of a really good one, add nothing. "
)
BANTER_OFF = "For THIS reply only: no remark at all, just the exact answer. "


def banter_line(rnd=random.random):
    """The dice are thrown here, not by the model: a model cannot be trusted to ration its own jokes."""
    return BANTER_ON if rnd() * 100 < BANTER_PCT else BANTER_OFF


def rewrite_text(text):
    """Return (new_text, changed)."""
    new, n = PERSONA_RE.subn(lambda m: NEW_PERSONA.format(name=m.group(1)) + banter_line(), text, count=1)
    return new, bool(n)


def drop_stale_questions(body):
    """Several user messages in a row with no answer between them means earlier turns failed or were abandoned
    (Google down, Jarvis restarted). Telling the model to ignore them is not reliable (it answered an old weather
    question and invented a forecast), so only the newest message of each such run is kept. Returns how many were dropped."""
    out, dropped = [], 0
    for msg in body.get("messages", []):
        if out and msg.get("role") == "user" and out[-1].get("role") == "user" \
                and isinstance(out[-1].get("content"), str) and isinstance(msg.get("content"), str):
            out[-1] = msg
            dropped += 1
        else:
            out.append(msg)
    body["messages"] = out
    return dropped


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
    if changed:  # only the main conversation calls, not Jarvis's small helper calls
        drop_stale_questions(body)
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
        changed, model, stripped, body = None, None, 0, None
        if raw and self.path.endswith("/chat/completions"):
            try:
                body = json.loads(raw)
                model = body.get("model")
                body, changed = rewrite_body(body)
                stripped = strip_tools(body)
                raw = json.dumps(body).encode()
            except Exception:
                changed, body = None, None
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("host", "content-length", "accept-encoding", "connection")}
        headers["Accept-Encoding"] = "identity"
        if raw:
            headers["Content-Length"] = str(len(raw))
        kind = None
        if body is not None:  # what kind of call is it? Only the first words of Jarvis's own fixed instructions, never speech
            sysm = next((m.get("content") for m in body.get("messages", []) if m.get("role") == "system"), "")
            kind = dict(sys="main" if changed else (sysm[:60] if isinstance(sysm, str) else "?"),
                        msgs=len(body.get("messages", [])), tools=len(body.get("tools") or []), kb=len(raw) // 1024)
        status, used = 0, model
        try:
            # The free tier sometimes stalls for 10-30 s or answers 503. Chat requests therefore get a short
            # time to start answering; if the model is too slow or overloaded the next model in line is asked
            # (the same request, only the model name differs) and a failing model is skipped for SKIP_S seconds.
            order = model_order(model) if body is not None and model else [None]
            for i, m in enumerate(order):
                last = i == len(order) - 1
                if m is not None and m != body.get("model"):
                    body["model"] = m
                    raw = json.dumps(body).encode()
                    headers["Content-Length"] = str(len(raw))
                used = m or model
                conn = http.client.HTTPSConnection(UPSTREAM, timeout=LAST_TIMEOUT_S if last or m is None else FIRST_BYTE_S,
                                                   context=ssl.create_default_context())
                try:
                    conn.request(self.command, self.path, body=raw or None, headers=headers)
                    r = conn.getresponse()
                except (TimeoutError, OSError):
                    if last or m is None:
                        raise
                    mark_bad(m)
                    conn.close()
                    continue
                if r.status in RETRY_STATUS and not last and m is not None:
                    mark_bad(m)
                    r.read()
                    conn.close()
                    continue
                break
            if conn.sock:
                conn.sock.settimeout(LAST_TIMEOUT_S)  # the answer has started: reading the rest may take a little
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
            if SPEAK_URL and changed and status == 200 and time.time() - t0 <= STALE_S:
                threading.Thread(target=speak_from_response, args=(bytes(buf), ctype), daemon=True).start()
        except Exception as e:  # report upstream trouble to Jarvis as a gateway error, never print secrets
            if not status:
                self.send_error(502, "relay: " + type(e).__name__)
            status = status or 502
        log(dict(t=time.strftime("%F %T"), method=self.command, path=self.path.split("?")[0], model=used,
                 asked=model if used != model else None, kind=kind, persona_rewritten=changed, tools_removed=stripped, status=status, seconds=round(time.time() - t0, 2)))

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
    assert "Answer ONLY Ivan's most recent message" in new and ("For THIS reply only" in new)
    assert banter_line(lambda: 0.0) == BANTER_ON and banter_line(lambda: 0.999) == BANTER_OFF
    on = sum(banter_line() == BANTER_ON for _ in range(20000)) / 200
    assert abs(on - BANTER_PCT) < 2, on
    print(f"selftest OK: dry remark allowed in {on:.1f} percent of replies (setting {BANTER_PCT:.0f}); stale-question rule present")
    u = lambda t: {"role": "user", "content": t}
    a = lambda t: {"role": "assistant", "content": t}
    b = {"messages": [{"role": "system", "content": "s"}, u("old1"), u("old2"), a("answer"), u("old3"), u("new")]}
    assert drop_stale_questions(b) == 2 and [m["content"] for m in b["messages"]] == ["s", "old2", "answer", "new"]
    b = {"messages": [{"role": "system", "content": "s"}, u("q1"), a("x"), u("q2")]}
    assert drop_stale_questions(b) == 0 and len(b["messages"]) == 4
    print("selftest OK: unanswered earlier questions are dropped, answered ones kept")
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
