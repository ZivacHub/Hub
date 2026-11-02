"""Hands-free latency test for the isair/jarvis trial (D12).

  python tests/jarvis_latency.py <wav to play> [rounds=3] [max_wait_s=60]

Plays a computer-voiced question through the speakers (Jarvis is set to listen to 'Stereo Mix', so it hears it directly)
and watches Jarvis's own state file (%TEMP%/jarvis_state: idle / listening / thinking / speaking) with timestamps.
Prints, per round, seconds after the question ended until each state first appears, and the full state change list.
Results are appended to tests/jarvis_latency.jsonl.
"""
import json
import os
import sys
import threading
import time
import wave
import winsound

wav_path = sys.argv[1]
rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 3
max_wait = float(sys.argv[3]) if len(sys.argv) > 3 else 60
STATE = os.path.join(os.environ["TEMP"], "jarvis_state")
with wave.open(wav_path) as w:
    clip_s = w.getnframes() / w.getframerate()


def read_state():
    try:
        with open(STATE) as f:
            return f.read().strip()
    except OSError:
        return "?"


results = []
for r in range(rounds):
    changes = []
    stop = threading.Event()

    def poll():
        last = read_state()
        while not stop.is_set():
            s = read_state()
            if s != last:
                changes.append((time.time(), s))
                last = s
            time.sleep(0.05)

    th = threading.Thread(target=poll, daemon=True)
    th.start()
    time.sleep(0.5)
    winsound.PlaySound(wav_path, winsound.SND_FILENAME)
    t_end = time.time()
    deadline = t_end + max_wait
    seen_speaking = False
    while time.time() < deadline:
        time.sleep(0.2)
        if any(s == "speaking" for _, s in changes):
            seen_speaking = True
        if seen_speaking and changes[-1][1] == "idle":
            break
    stop.set()
    th.join()
    first = {}
    for t, s in changes:
        first.setdefault(s, round(t - t_end, 1))
    res = dict(round=r + 1, clip_s=round(clip_s, 1), first_seen_after_question_end_s=first,
               changes=[(round(t - t_end, 1), s) for t, s in changes], answered=seen_speaking)
    print(json.dumps(res), flush=True)
    results.append(res)
    time.sleep(10)  # let the follow-up listening window close
with open("tests/jarvis_latency.jsonl", "a") as f:
    f.write(json.dumps(dict(ts=time.strftime("%F %T"), wav=wav_path, results=results)) + "\n")
