"""Step 0.2: the same 10 spoken sentences go to each local model; it must PICK one command name.

Draft command list only (the real one is written in step 2.2). The model never answers questions,
it only picks a command and a project name. Prints a markdown table and writes results JSON.
Usage: python tests/model_pick_test.py qwen3:8b llama3.1:8b
"""
import json
import subprocess
import sys
import time
import urllib.request

URL = "http://127.0.0.1:11434/api/chat"

COMMANDS = {
    "project_status": "how far a project is (percent, phase, next step). needs: project",
    "decisions_waiting": "list decisions waiting on the owner. needs: project (or all)",
    "list_projects": "list all projects",
    "open_dashboard": "open the dashboard web page",
    "latest_claude_answer": "read the latest Claude answer of a project. needs: project",
    "stop_listening": "stop listening until woken again",
    "dictate_idea": "start taking a new idea note",
    "unsupported": "anything else, anything unsafe (delete, post, spend money), or unclear",
}
PROJECTS = "ClipForge (Socials Automatisation), AI_Orcestration, Game, Hub, Casino Rewamp, Daily_Navigator, Cash_Gate, Agency"

# (spoken sentence, expected command, expected project or None)
SENTENCES = [
    ("Hey Jarvis, how is ClipForge going?", "project_status", "ClipForge"),
    ("Pull out the dashboard.", "open_dashboard", None),
    ("What percentage are we on in the orchestration project?", "project_status", "AI_Orcestration"),
    ("Are any decisions waiting on me?", "decisions_waiting", "all"),
    ("What was Claude's last answer in the game project?", "latest_claude_answer", "Game"),
    ("Which projects do I have?", "list_projects", None),
    ("I want to build a dropshipping site with this and this.", "dictate_idea", None),
    ("That's enough, stop listening.", "stop_listening", None),
    ("Delete the casino folder.", "unsupported", None),
    ("Post it on Instagram right now.", "unsupported", None),
]

SYSTEM = (
    "You route spoken requests for a voice assistant. You do NOT answer questions. "
    "Pick exactly one command from this list and a project if the command needs one.\n"
    + "\n".join(f"- {k}: {v}" for k, v in COMMANDS.items())
    + f"\nKnown projects: {PROJECTS}.\n"
    'Reply with JSON only: {"command": "<name>", "project": "<project or null>"}'
)


def gpu_used_mib():
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True
    )
    return int(out.strip().splitlines()[0])


def ask(model, sentence):
    body = {
        "model": model,
        "stream": False,
        "format": "json",
        "think": False,
        "options": {"temperature": 0},
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": sentence}],
    }
    t0 = time.time()
    try:
        data = _post(body)
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise
        body.pop("think")  # model has no thinking switch
        data = _post(body)
    return data, time.time() - t0


def _post(body):
    req = urllib.request.Request(URL, json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def main(models):
    results = {}
    for model in models:
        # warm-up so load time is not counted in per-sentence seconds
        t0 = time.time()
        ask(model, "Hello")
        load_s = time.time() - t0
        rows, peak = [], 0
        for sentence, want_cmd, want_proj in SENTENCES:
            data, secs = ask(model, sentence)
            peak = max(peak, gpu_used_mib())
            try:
                got = json.loads(data["message"]["content"])
            except Exception:
                got = {"command": "BAD_JSON", "project": None}
            cmd_ok = got.get("command") == want_cmd
            proj_ok = True
            if want_proj and want_proj != "all":
                proj_ok = want_proj.lower() in str(got.get("project")).lower()
            rows.append(
                dict(sentence=sentence, want=want_cmd, got=got.get("command"), project=got.get("project"),
                     ok=cmd_ok and proj_ok, seconds=round(secs, 2),
                     tok_s=round(data.get("eval_count", 0) / max(data.get("eval_duration", 1) / 1e9, 1e-9), 1))
            )
        results[model] = dict(load_and_first_s=round(load_s, 1), peak_gpu_mib=peak, rows=rows)
        subprocess.run(["ollama", "stop", model], capture_output=True)
    name = "_".join(m.replace(":", "-").replace("/", "-") for m in models)
    json.dump(results, open(f"tests/model_pick_results_{name}.json", "w"), indent=2)
    for model, res in results.items():
        ok = sum(r["ok"] for r in res["rows"])
        avg = sum(r["seconds"] for r in res["rows"]) / len(res["rows"])
        print(f"\n### {model}: {ok}/10 right, avg {avg:.2f} s, first load {res['load_and_first_s']} s, peak GPU {res['peak_gpu_mib']} MiB")
        print("| Sentence | Wanted | Picked | Project | Right | Seconds |\n|---|---|---|---|---|---|")
        for r in res["rows"]:
            print(f"| {r['sentence']} | {r['want']} | {r['got']} | {r['project']} | {'yes' if r['ok'] else 'NO'} | {r['seconds']} |")


if __name__ == "__main__":
    main(sys.argv[1:])
