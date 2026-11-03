"""Step 2.3: 40 spoken-style sentences go to Gemini (through the relay, as Jarvis does) with Jarvis's real tool list.
Does it pick the right tool and project, and does it stay away from tools for chit-chat and unsupported requests?

  python tests/tool_pick_test.py            (the relay must be running on 127.0.0.1:8787; uses the key in Jarvis's config, never printed)
Writes tests/tool_pick_results.json and prints a table.
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(r"C:\Users\Ivan\.config\jarvis\config.json", encoding="utf-8"))
KEY, MODEL = cfg["llm_api_key"], cfg["llm_chat_model"]
URL = "http://127.0.0.1:8787/v1beta/openai/chat/completions"


def tool(name, desc, props=None, req=None):
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props or {}, **({"required": req} if req else {})}}}


TOOLS = [
    tool("hub__list_projects", "List all of Ivan's BUSNUS projects with their progress. Use for 'which projects do I have?' or 'how are my projects doing?'. Read-only."),
    tool("hub__project_status", "How far one project is: current phase, steps done, percent, next step, decisions waiting, handoff age. Use for 'how is ClipForge going?', 'what percentage are we on in the game project?'. Read-only. The nickname ClipForge is understood.",
         {"project": {"type": "string", "description": "Project name or nickname as the user said it."}}, ["project"]),
    tool("hub__decisions_waiting", "Decisions that are waiting on Ivan, for one project or for all projects ('all'). Use for 'are any decisions waiting on me?'. Read-only.",
         {"project": {"type": "string", "description": "The project the user named, exactly as said. Use 'all' only when the user named no project."}}),
    tool("claude__ask_claude", "Ask Claude a question that needs real reading or reasoning about Ivan's BUSNUS project files (notes, plans, handoffs). Slow: 10 to 40 seconds. Use ONLY when the user explicitly says to ask Claude, or when the hub__ status tools cannot answer. Never use it for simple progress, phase, step, percent or decisions questions. Read-only: it cannot change, send, post or delete anything. Returns a short spoken-style answer.",
         {"question": {"type": "string", "description": "The question, in one or two plain sentences."}}, ["question"]),
    tool("webSearch", "Search the web for current information.", {"query": {"type": "string"}}, ["query"]),
    tool("stop", "Stop speaking or listening right now."),
]
def real_prompt():
    """Jarvis's REAL system prompt (from its GitHub source), so the relay rewrites it exactly as in daily use."""
    cache = os.path.join(HERE, "_jarvis_prompt.txt")
    if not os.path.exists(cache):
        src = urllib.request.urlopen("https://raw.githubusercontent.com/isair/jarvis/main/src/jarvis/system_prompt.py", timeout=30).read().decode()
        ns = {}
        exec(src, ns)
        open(cache, "w", encoding="utf-8").write(ns["build_system_prompt"]("Jarvis"))
    return open(cache, encoding="utf-8").read() + "\n[Context: Monday, 12:00, Zagreb]"


SYSTEM = real_prompt()

# (sentence, expected tool or None, expected project folder (or None / "all"))
T = [
    ("How is ClipForge going?", "project_status", "Socials Automatisation"),
    ("What percentage are we on in the orchestration project?", "project_status", "AI_Orcestration"),
    ("Where are we with the game?", "project_status", "Game"),
    ("Yo, what's up with Clip Forge?", "project_status", "Socials Automatisation"),
    ("Tell me about the Hub project progress.", "project_status", "Hub"),
    ("How far along is the job application thing?", "project_status", "Automatic_Job_Application"),
    ("What's the next step for the script maker?", "project_status", "Learning_Script_Maker"),
    ("Is ClipForge close to done?", "project_status", "Socials Automatisation"),
    ("On which step is Ivan's game project?", "project_status", "Game"),
    ("Which step is the hub project on?", "project_status", "Hub"),
    ("What's going on in the learning script maker?", "project_status", "Learning_Script_Maker"),
    ("What's going on there?", None, None),
    ("Give me a status on the game project.", "project_status", "Game"),
    ("How's the hub coming along?", "project_status", "Hub"),
    ("Uh, clip... forge, how we doing?", "project_status", "Socials Automatisation"),
    ("What phase is the learning script maker on?", "project_status", "Learning_Script_Maker"),
    ("Status of casino rewamp.", "project_status", "Casino Rewamp"),
    ("How's the daily navigator project?", "project_status", "Daily_Navigator"),
    ("Which projects do I have?", "list_projects", None),
    ("List my projects.", "list_projects", None),
    ("What am I working on overall?", "list_projects", None),
    ("Show me everything I've got going.", "list_projects", None),
    ("How are all my projects doing?", "list_projects", None),
    ("Are any decisions waiting on me?", "decisions_waiting", "all"),
    ("Do I owe anyone an answer in the game project?", "decisions_waiting", "Game"),
    ("What needs my decision?", "decisions_waiting", "all"),
    ("Any open decisions in ClipForge?", "decisions_waiting", "Socials Automatisation"),
    ("Anything waiting for my approval in the Hub?", "decisions_waiting", "Hub"),
    ("What decisions are pending?", "decisions_waiting", "all"),
    ("Has the game project got questions for me?", "decisions_waiting", "Game"),
    ("Ask Claude which phase the Hub project is in.", "ask_claude", None),
    ("Ask Claude to summarise the last handoff of the game project.", "ask_claude", None),
    ("Have Claude check what the ClipForge plan says about publishing.", "ask_claude", None),
    ("Ask Claude why the Hub is slower than planned.", "ask_claude", None),
    ("Ask Claude what the biggest risk in the orchestration project is.", "ask_claude", None),
    ("Search the web for the newest Gemini model.", "webSearch", None),
    ("Look up the weather forecast for Zagreb.", "webSearch", None),
    ("Stop.", "stop", None),
    ("How are you today?", None, None),
    ("Thank you.", None, None),
    ("Delete the casino folder.", None, None),
    ("Post it on Instagram right now.", None, None),
    ("Send an email to my girlfriend saying I'm late.", None, None),
    ("Reply to the decision in the game project with yes.", None, None),
]


def ask(sentence):
    body = {"model": MODEL, "temperature": 0, "tools": TOOLS, "tool_choice": "auto",
            "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "Jarvis, " + sentence[0].lower() + sentence[1:]}]}
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json", "Authorization": "Bearer " + KEY})
    for attempt in range(4):
        try:
            d = json.load(urllib.request.urlopen(req, timeout=60))
            m = d["choices"][0]["message"]
            calls = [(c["function"]["name"].split("__")[-1], json.loads(c["function"].get("arguments") or "{}")) for c in (m.get("tool_calls") or [])]
            return calls, (m.get("content") or "")
        except urllib.error.HTTPError as e:
            if e.code in (429, 503):
                time.sleep(8 * (attempt + 1))
                continue
            return [("HTTP%d" % e.code, {})], ""
        except Exception as e:
            time.sleep(3)
    return [("ERROR", {})], ""


def resolves_to(arg, folder):
    out = subprocess.run(["node", os.path.join(HERE, "..", "tools", "hub_status", "status.mjs"), "project", arg],
                         capture_output=True, text=True, encoding="utf-8").stdout.strip()
    return out.startswith(folder)


rows, ok_n = [], 0
for s, want, proj in T:
    calls, text = ask(s)
    got = calls[0][0] if calls else None
    args = calls[0][1] if calls else {}
    good = got == want
    note = ""
    if good and proj and want in ("project_status", "decisions_waiting"):
        arg = str(args.get("project", ""))
        if proj == "all":
            good = arg.strip().lower() in ("all", "", "everything") or want == "decisions_waiting" and not arg
        else:
            good = bool(arg) and resolves_to(arg, proj)
        note = f"project='{arg}'"
    if want is None and got is None and not text.strip():
        good, note = False, "empty reply"
    ok_n += good
    rows.append(dict(sentence=s, want=want, got=got, note=note, ok=good, reply=text[:80]))
    time.sleep(0.4)

json.dump(rows, open(os.path.join(HERE, "tool_pick_results.json"), "w"), indent=1)
print(f"\n{ok_n}/{len(T)} right ({100 * ok_n // len(T)} percent), model {MODEL}\n")
print("| Sentence | Wanted | Picked | Right | Note |\n|---|---|---|---|---|")
for r in rows:
    print(f"| {r['sentence']} | {r['want']} | {r['got']} | {'yes' if r['ok'] else 'NO'} | {r['note'] or r['reply']} |")
