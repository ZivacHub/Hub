"""Local speaker service: reads text aloud in Daniel's voice (Kokoro bm_daniel), sentence by sentence (D4).

The persona relay sends Jarvis's replies here (Jarvis's own voice is switched off in its config).
  POST /say   {"text": "..."}   queue text to be spoken
  POST /stop                    stop speaking now and clear the queue
  GET  /health
Runs Kokoro on the processor by default (0 GB graphics memory); set KOKORO_DEVICE=cuda to use the card.
Log: speaker_log.jsonl (time, characters, seconds to first sound; never the text; git-ignored).
Run:  python tools/jarvis_trial/kokoro_speaker.py [port=8788]
"""
import json
import os
import queue
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import sounddevice as sd

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "speaker_log.jsonl")
VOICE = "bm_daniel"
SPEED = float(os.environ.get("KOKORO_SPEED", "0.95"))  # Daniel's pace; matched to Jarvis's own voice timing (see memory)
DEVICE = os.environ.get("KOKORO_DEVICE", "cpu")
q = queue.Queue()
stop_flag = threading.Event()
_pipe = None


def mute_jarvis_loop():
    """Keep Jarvis.exe's own audio muted in Windows' volume mixer (its Piper voice, beeps and tune). Jarvis must keep its
    own voice ON so it still opens its follow-up listening window when it finishes speaking; Daniel is what you hear.
    Only the mixer entry of Jarvis.exe is touched, nothing else."""
    import comtypes
    from pycaw.pycaw import AudioUtilities
    comtypes.CoInitialize()
    while True:
        try:
            for s in AudioUtilities.GetAllSessions():
                p = s.Process
                if p is not None and p.name().lower() == "jarvis.exe":
                    vol = s.SimpleAudioVolume
                    if not vol.GetMute():
                        vol.SetMute(1, None)
        except Exception:
            pass
        time.sleep(0.15)


def clean(text):
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"[*_`#>]+", "", text)
    text = re.sub(r"https?://\S+", "link", text)
    return re.sub(r"\s+", " ", text).strip()


def pipe():
    global _pipe
    if _pipe is None:
        from kokoro import KPipeline
        _pipe = KPipeline(lang_code="b", repo_id="hexgrad/Kokoro-82M", device=DEVICE)
    return _pipe


def worker():
    while True:
        text, t_in = q.get()
        t0, first = time.time(), None
        try:
            for _, _, audio in pipe()(text, voice=VOICE, speed=SPEED):
                if stop_flag.is_set():
                    break
                if first is None:
                    first = time.time() - t_in
                sd.play(np.asarray(audio, dtype="float32"), 24000)
                while sd.get_stream().active and not stop_flag.is_set():
                    time.sleep(0.02)
                if stop_flag.is_set():
                    sd.stop()
                    break
        except Exception as e:
            sys.stderr.write("speaker error: " + type(e).__name__ + "\n")
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(dict(t=time.strftime("%F %T"), epoch=round(t_in, 2), chars=len(text),
                                    first_sound_s=None if first is None else round(first, 2),
                                    total_s=round(time.time() - t0, 2), stopped=stop_flag.is_set())) + "\n")
        if q.empty():
            stop_flag.clear()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _ok(self, code=200, body=b"ok"):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._ok(200, b'{"ok":true,"voice":"%s","device":"%s"}' % (VOICE.encode(), DEVICE.encode()))

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        if self.path == "/stop":
            stop_flag.set()
            while not q.empty():
                try:
                    q.get_nowait()
                except queue.Empty:
                    break
            sd.stop()
            return self._ok()
        if self.path == "/say":
            try:
                text = clean(json.loads(raw).get("text", ""))
            except Exception:
                return self._ok(400, b"bad json")
            if text:
                stop_flag.clear()
                q.put((text, time.time()))
            return self._ok()
        self._ok(404, b"no")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=mute_jarvis_loop, daemon=True).start()
    pipe()  # load now so the first reply is not slow
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
