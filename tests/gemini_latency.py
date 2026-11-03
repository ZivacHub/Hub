"""Time Gemini models with a one-line question (direct to Google, key read in-process, never printed).
Usage: python tests/gemini_latency.py [model ...]   (no model = list models, time a default few)"""
import json, sys, time, urllib.request, urllib.error

cfg = json.load(open(r"C:\Users\Ivan\.config\jarvis\config.json", encoding="utf-8"))
KEY = cfg["llm_api_key"]
BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


def call(path, body=None, timeout=60):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode() if body else None,
                                 {"Content-Type": "application/json", "Authorization": "Bearer " + KEY})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = json.loads(r.read())
            return r.status, time.time() - t0, data
    except urllib.error.HTTPError as e:
        return e.code, time.time() - t0, None
    except Exception as e:
        return type(e).__name__, time.time() - t0, None


if __name__ == "__main__":
    s, t, data = call("/models")
    names = sorted(m["id"].replace("models/", "") for m in data["data"]) if data else []
    print("models status", s, round(t, 2), "s;", len(names), "models")
    print([n for n in names if "gemini" in n or "gemma" in n])
    models = sys.argv[1:] or [cfg["llm_chat_model"]]
    for m in models:
        for i in range(3):
            body = {"model": m, "messages": [{"role": "user", "content": "Reply with the single word: ready"}], "max_tokens": 20}
            s, t, d = call("/chat/completions", body)
            txt = (d["choices"][0]["message"].get("content") or "")[:20].replace("\n", " ") if d else ""
            print(f"{m:34s} run{i+1}: status {s}  {t:5.2f}s  '{txt}'")


def big_run(model, n=8):
    """Same, but with Jarvis's real long system prompt (tests/_jarvis_prompt.txt, made by tool_pick_test)."""
    import os
    sysmsg = open(os.path.join(os.path.dirname(__file__), "_jarvis_prompt.txt"), encoding="utf-8").read()
    ts = []
    for i in range(n):
        body = {"model": model, "max_tokens": 60, "messages": [{"role": "system", "content": sysmsg},
                {"role": "user", "content": "How is ClipForge going?"}]}
        s, t, d = call("/chat/completions", body, timeout=90)
        ts.append(t)
        print(f"{model:30s} big run{i+1}: status {s} {t:5.2f}s")
    ts.sort()
    print("median", round(ts[len(ts)//2], 2), "max", round(ts[-1], 2))
