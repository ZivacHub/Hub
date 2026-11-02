"""Standby test for the voice (Chatterbox clone): load time, graphics memory while loaded, and whether the memory
really comes back when we unload it (so the Hub can sit with 0 GB on the card until Ivan talks).

  python tests/measure_standby.py
"""
import gc
import os
import subprocess
import time

import torch  # noqa: F401  load the CUDA helper libraries first
from chatterbox.tts import ChatterboxTTS

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "audio", "voice_audition", "gemini_Iapetus.wav")
TEXT = "Good evening. The Hub is in phase one, and two decisions are awaiting your attention."


def gpu():
    return int(subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                                       text=True).strip().splitlines()[0])


base = gpu()
print(f"card before: {base} MiB")
for round_no in (1, 2):
    t = time.time()
    m = ChatterboxTTS.from_pretrained(device="cuda")
    load = time.time() - t
    t = time.time()
    m.generate(TEXT, audio_prompt_path=REF)
    first = time.time() - t
    t = time.time()
    m.generate(TEXT, audio_prompt_path=REF)
    warm = time.time() - t
    held = gpu() - base
    print(f"load #{round_no}: {load:.1f}s; first sentence {first:.1f}s; next sentence {warm:.1f}s; card holds +{held} MiB", flush=True)
    del m
    gc.collect()
    torch.cuda.empty_cache()
    time.sleep(2)
    print(f"  after unloading (process still alive): +{gpu() - base} MiB over before", flush=True)
