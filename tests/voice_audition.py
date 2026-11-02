"""Voice audition: the same butler sentence in several candidate voices, plus a listening page.

  python tests/voice_audition.py kokoro     Kokoro British male voices (local, on this PC)
  python tests/voice_audition.py gemini     Gemini TTS voices (Google's service; uses the key in Jarvis's config, never printed)
  python tests/voice_audition.py page       build tests/audio/voice_audition/index.html from what exists

Output goes to tests/audio/voice_audition/ (git-ignored). Timings are written to timings.json.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "audio", "voice_audition")
os.makedirs(OUT, exist_ok=True)
TEXT = "Good evening. The Hub is in phase one, and two decisions are awaiting your attention."
STYLE = "formal, calm and precise, in the voice of a real British butler"
TIMINGS = os.path.join(OUT, "timings.json")


def save_timing(name, **kw):
    d = json.load(open(TIMINGS)) if os.path.exists(TIMINGS) else {}
    d[name] = kw
    json.dump(d, open(TIMINGS, "w"), indent=1)


def kokoro():
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
    p = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M", device="cuda")
    for v in ("bm_george", "bm_fable", "bm_lewis", "bm_daniel"):
        for _ in range(2):  # first call warms up; the second is the timing that matters
            t = time.time()
            audio = np.concatenate([a for _, _, a in p(TEXT, voice=v, speed=0.95)])
            secs = time.time() - t
        sf.write(os.path.join(OUT, f"kokoro_{v}.wav"), audio, 24000)
        save_timing(f"kokoro_{v}", make_seconds=round(secs, 2), audio_seconds=round(len(audio) / 24000, 1))
        print(f"kokoro {v}: made in {secs:.2f}s ({len(audio)/24000:.1f}s of speech)", flush=True)


def find_audio(obj):
    """Return the longest base64 'data' string found anywhere in a JSON response."""
    best = ""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "data" and isinstance(v, str) and len(v) > len(best):
                best = v
            else:
                c = find_audio(v)
                if len(c) > len(best):
                    best = c
    elif isinstance(obj, list):
        for v in obj:
            c = find_audio(v)
            if len(c) > len(best):
                best = c
    return best


def gemini():
    cfg = json.load(open(r"C:\Users\Ivan\.config\jarvis\config.json", encoding="utf-8"))
    key = cfg["llm_api_key"]
    models = ["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"]
    voices = ["Charon", "Orus", "Iapetus", "Schedar", "Sadaltager", "Algieba"]
    model = None
    for v in voices:
        done = False
        for m in ([model] if model else models):
            body = {"model": m,
                    "input": [{"type": "user_input", "content": [{"type": "text", "text": TEXT,
                               "annotations": [{"type": "speech_metadata", "style": STYLE}]}]}],
                    "response_format": {"type": "audio"},
                    "generation_config": {"speech_config": [{"voice": v}]}}
            req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/interactions",
                                         json.dumps(body).encode(),
                                         {"Content-Type": "application/json", "x-goog-api-key": key})
            for attempt in range(3):
                t = time.time()
                try:
                    data = json.load(urllib.request.urlopen(req, timeout=120))
                    b64 = find_audio(data)
                    if not b64:
                        print(f"gemini {v} {m}: no audio in reply: {str(data)[:200]}")
                        break
                    open(os.path.join(OUT, f"gemini_{v}.wav"), "wb").write(base64.b64decode(b64))
                    secs = time.time() - t
                    save_timing(f"gemini_{v}", model=m, make_seconds=round(secs, 2))
                    print(f"gemini {v} ({m}): made in {secs:.2f}s", flush=True)
                    model, done = m, True
                    break
                except urllib.error.HTTPError as e:
                    msg = e.read().decode(errors="replace")[:200].replace(key, "<key>")
                    print(f"gemini {v} {m}: HTTP {e.code} {msg}", flush=True)
                    if e.code == 429:
                        time.sleep(20)
                        continue
                    break
                except Exception as e:
                    print(f"gemini {v} {m}: {type(e).__name__}", flush=True)
                    break
            if done:
                break
        time.sleep(6)  # stay well inside free-tier rate limits


NOTES = {
    "kokoro_bm_george": "Kokoro, local. British male, the best-rated British male in Kokoro (grade C).",
    "kokoro_bm_fable": "Kokoro, local. British male, storyteller tone (grade C).",
    "kokoro_bm_lewis": "Kokoro, local. British male (grade D+).",
    "kokoro_bm_daniel": "Kokoro, local. British male (grade D).",
}


def page():
    t = json.load(open(TIMINGS)) if os.path.exists(TIMINGS) else {}
    files = sorted(f for f in os.listdir(OUT) if f.endswith(".wav"))
    rows = []
    for f in files:
        name = f[:-4]
        info = t.get(name, {})
        note = NOTES.get(name, "Gemini voice service (Google, free key). Style asked: formal British butler." if name.startswith("gemini") else "")
        secs = f"made in {info['make_seconds']} s" if "make_seconds" in info else ""
        rows.append(f'<div class="v"><h3>{name.replace("_", " ")}</h3><p>{note} {secs}</p><audio controls preload="none" src="{f}"></audio></div>')
    html = f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Voice audition</title><style>
:root{{--bg:#fff;--fg:#1a1a1a;--card:#f3f3f3;--mut:#666}}@media(prefers-color-scheme:dark){{:root{{--bg:#121212;--fg:#eee;--card:#1e1e1e;--mut:#999}}}}
body{{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;max-width:680px;margin:0 auto;padding:16px}}
.v{{background:var(--card);border-radius:10px;padding:12px 16px;margin:12px 0}}h3{{margin:0 0 2px}}p{{margin:0 0 8px;color:var(--mut);font-size:14px}}audio{{width:100%}}</style>
<h1>Voice audition</h1><p>Every voice says the same sentence: “{TEXT}”. Listen to each one, then tell Claude your top two and what you did not like.</p>
{''.join(rows)}</html>"""
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(html)
    print("page written:", os.path.join(OUT, "index.html"), len(files), "voices")


if __name__ == "__main__":
    {"kokoro": kokoro, "gemini": gemini, "page": page}[sys.argv[1]]()
