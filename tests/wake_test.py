"""Step 1.1: "Hey Jarvis" wake test with a real microphone.

  python tests/wake_test.py tries <device> [rounds=20]   rounds of: beep, 3 s window in which Ivan says "Hey Jarvis"; counts wakes
  python tests/wake_test.py noise <device> [minutes=20]  listens for N minutes while normal talk/video plays; counts false wakes (no beeps)

A wake = hey_jarvis score >= THRESHOLD in a 80 ms frame (noise mode: at most one wake per 3 s). Results appended to tests/wake_results.jsonl.
"""
import json
import sys
import time
import winsound

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

THRESHOLD = 0.5
RATE, FRAME = 16000, 1280
mode, dev = sys.argv[1], int(sys.argv[2])
arg = float(sys.argv[3]) if len(sys.argv) > 3 else 20
m = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")


def score_audio(a):
    m.reset()
    best = 0.0
    for i in range(0, len(a) - FRAME + 1, FRAME):
        best = max(best, max(m.predict(a[i:i + FRAME]).values()))
    return best


if mode == "tries":
    rounds = int(arg)
    time.sleep(10)
    for _ in range(3):
        winsound.Beep(800, 150); time.sleep(0.85)
    scores = []
    for r in range(rounds):
        time.sleep(1.2)
        winsound.Beep(1200, 250)
        a = sd.rec(int(3 * RATE), samplerate=RATE, channels=1, dtype="int16", device=dev)
        sd.wait()
        s = score_audio(a[:, 0])
        scores.append(round(float(s), 2))
        print(f"try {r + 1}: score {s:.2f} {'WOKE' if s >= THRESHOLD else 'missed'}", flush=True)
    woke = int(sum(s >= THRESHOLD for s in scores))
    res = dict(test="tries", device=dev, rounds=rounds, woke=woke, threshold=THRESHOLD, scores=scores)
else:
    minutes = arg
    end = time.time() + minutes * 60
    wakes, last, peak = [], 0.0, 0.0
    m.reset()
    with sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=FRAME, device=dev) as st:
        while time.time() < end:
            frame, _ = st.read(FRAME)
            s = max(m.predict(frame[:, 0]).values())
            peak = max(peak, float(s))
            if s >= 0.25 and time.time() - last > 3:  # log everything from 0.25 up so several thresholds can be judged afterwards
                last = time.time()
                wakes.append((round(minutes * 60 - (end - last)), round(float(s), 2)))
                print(f"wake-like sound at {wakes[-1][0]} s (score {s:.2f})", flush=True)
    res = dict(test="noise", device=dev, minutes=minutes, events_at_seconds_and_score=wakes,
               false_wakes_at_0_5=sum(sc >= 0.5 for _, sc in wakes), false_wakes_at_0_4=sum(sc >= 0.4 for _, sc in wakes),
               false_wakes_at_0_3=sum(sc >= 0.3 for _, sc in wakes), highest_score_seen=round(peak, 2))
print(json.dumps(res))
with open("tests/wake_results.jsonl", "a") as f:
    f.write(json.dumps(res) + "\n")
