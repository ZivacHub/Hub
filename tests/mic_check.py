"""Step 1.1 helper: after a delay and a beep, record a few seconds from the chosen microphone and report level and wake score.
Usage: python tests/mic_check.py <device index> [delay seconds] [record seconds]
"""
import os
import sys
import time
import wave
import winsound

import numpy as np
import sounddevice as sd
from openwakeword.model import Model

HERE = os.path.dirname(os.path.abspath(__file__))
dev = int(sys.argv[1])
delay = float(sys.argv[2]) if len(sys.argv) > 2 else 20
secs = float(sys.argv[3]) if len(sys.argv) > 3 else 6

info = sd.query_devices(dev)
rate = 16000
time.sleep(delay)
for _ in range(3):  # three short warning beeps, then one long beep, then recording starts
    winsound.Beep(800, 150)
    time.sleep(0.85)
winsound.Beep(1200, 600)
audio = sd.rec(int(secs * rate), samplerate=rate, channels=1, dtype="int16", device=dev)
sd.wait()
a = audio[:, 0]
peak = int(np.abs(a).max())
rms = float(np.sqrt(np.mean(a.astype(np.float64) ** 2)))
db = 20 * np.log10(max(rms, 1) / 32768)
with wave.open(os.path.join(HERE, "audio", "mic_check.wav"), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(a.tobytes())
m = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
best = 0.0
for i in range(0, len(a) - 1280, 1280):
    best = max(best, max(m.predict(a[i:i + 1280]).values()))
print(f"device {dev} = {info['name']}; peak {peak}/32768; average level {db:.1f} dBFS; best hey_jarvis score {best:.2f}")
