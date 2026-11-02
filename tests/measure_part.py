"""Step 0.3: measure ONE voice part in its own process: graphics memory, RAM, processor, idle and working.

Usage: .venv/Scripts/python tests/measure_part.py <wake|whisper-small|whisper-turbo|kokoro|chatterbox|ollama:<model>>
Prints one JSON line (also appended to tests/measure_results.jsonl). Uses test audio, no microphone.
Graphics memory = whole-card used MiB from nvidia-smi minus the baseline before the part is loaded.
RAM = this process's working set. Processor = percent of ONE core over the window (psutil), so 100 = one full core.
"""
import json
import os
import subprocess
import sys
import threading
import time
import wave

import numpy as np
import psutil

HERE = os.path.dirname(os.path.abspath(__file__))
CLIP = os.path.join(HERE, "audio", "sapi_command.wav")
PROC = psutil.Process()


def gpu_mib():
    out = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True)
    return int(out.strip().splitlines()[0])


class Sampler:
    """Samples whole-card graphics memory and this process's CPU/RAM while a block runs."""
    def __enter__(self):
        self.gpu_peak, self.ram_peak, self.stop = 0, 0, False
        PROC.cpu_percent(None)
        self.t0 = time.time()
        self.th = threading.Thread(target=self._run, daemon=True)
        self.th.start()
        return self

    def _run(self):
        while not self.stop:
            self.gpu_peak = max(self.gpu_peak, gpu_mib())
            self.ram_peak = max(self.ram_peak, PROC.memory_info().rss)
            time.sleep(0.25)

    def __exit__(self, *a):
        self.stop = True
        self.th.join()
        self.secs = time.time() - self.t0
        self.cpu = PROC.cpu_percent(None)  # percent of one core since __enter__

    def row(self, base_gpu):
        return dict(gpu_mib_over_baseline=self.gpu_peak - base_gpu, ram_mib=round(self.ram_peak / 2**20),
                    cpu_one_core_pct=round(self.cpu, 1), seconds=round(self.secs, 1))


def read_clip():
    with wave.open(CLIP) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def part_wake(base):
    import openwakeword
    from openwakeword.model import Model
    openwakeword.utils.download_models(["hey_jarvis"])
    t0 = time.time()
    m = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")
    load = round(time.time() - t0, 1)
    ram_loaded = round(PROC.memory_info().rss / 2**20)
    rng = np.random.default_rng(0)
    frame = 1280  # 80 ms at 16 kHz
    # idle = always-on listening to quiet room noise, fed in real time
    with Sampler() as idle:
        end = time.time() + 20
        while time.time() < end:
            m.predict((rng.normal(0, 30, frame)).astype(np.int16))
            time.sleep(0.08)
    clip = read_clip()
    best = 0.0
    # working = a spoken "Hey Jarvis ..." clip, as fast as it can be fed (heaviest case)
    with Sampler() as work:
        for i in range(0, len(clip) - frame, frame):
            sc = m.predict(clip[i:i + frame])
            best = max(best, max(sc.values()))
    return dict(load_s=load, ram_after_load_mib=ram_loaded, idle=idle.row(base), working=work.row(base),
                note=f"best hey_jarvis score on a Windows-voice clip: {best:.2f} (not a real wake test; that is step 1.1)")


def part_whisper(base, name):
    import torch  # noqa: F401  loads PyTorch's CUDA helper libraries (cublas/cudnn) that faster-whisper needs
    from faster_whisper import WhisperModel
    t0 = time.time()
    try:
        m = WhisperModel(name, device="cuda", compute_type="float16")
        dev = "cuda float16"
    except Exception as e:
        return dict(error=f"cuda failed: {type(e).__name__}: {e}")
    load = round(time.time() - t0, 1)
    ram_loaded = round(PROC.memory_info().rss / 2**20)
    with Sampler() as idle:
        time.sleep(8)
    texts, times = [], []
    with Sampler() as work:
        for _ in range(5):
            t = time.time()
            segs, _ = m.transcribe(CLIP, beam_size=1, language="en")
            texts.append(" ".join(s.text.strip() for s in segs))
            times.append(round(time.time() - t, 2))
    return dict(device=dev, load_s=load, ram_after_load_mib=ram_loaded, idle=idle.row(base), working=work.row(base),
                transcribe_seconds_each=times, heard=texts[-1])


def part_kokoro(base):
    import soundfile as sf
    from kokoro import KPipeline
    t0 = time.time()
    p = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cuda")
    load = round(time.time() - t0, 1)
    ram_loaded = round(PROC.memory_info().rss / 2**20)
    text = "Good evening. ClipForge is at sixty percent, and two decisions are waiting for you."
    with Sampler() as idle:
        time.sleep(8)
    times, dur = [], 0
    with Sampler() as work:
        for _ in range(3):
            t = time.time()
            audio = np.concatenate([a for _, _, a in p(text, voice="bm_george")])
            times.append(round(time.time() - t, 2))
            dur = len(audio) / 24000
    sf.write(os.path.join(HERE, "audio", "kokoro_sample.wav"), audio, 24000)
    return dict(load_s=load, ram_after_load_mib=ram_loaded, idle=idle.row(base), working=work.row(base),
                speak_seconds_each=times, spoken_audio_seconds=round(dur, 1))


def part_chatterbox(base):
    import torch
    import torchaudio as ta
    from chatterbox.tts import ChatterboxTTS
    t0 = time.time()
    m = ChatterboxTTS.from_pretrained(device="cuda")
    load = round(time.time() - t0, 1)
    ram_loaded = round(PROC.memory_info().rss / 2**20)
    text = "Good evening. ClipForge is at sixty percent, and two decisions are waiting for you."
    with Sampler() as idle:
        time.sleep(8)
    times, dur = [], 0
    with Sampler() as work:
        for _ in range(3):
            t = time.time()
            wav = m.generate(text)
            times.append(round(time.time() - t, 2))
            dur = wav.shape[-1] / m.sr
    ta.save(os.path.join(HERE, "audio", "chatterbox_sample.wav"), wav.cpu(), m.sr)
    return dict(load_s=load, ram_after_load_mib=ram_loaded, idle=idle.row(base), working=work.row(base),
                speak_seconds_each=times, spoken_audio_seconds=round(dur, 1), torch=torch.__version__)


def part_ollama(base, model):
    import urllib.request
    def call(prompt):
        body = json.dumps(dict(model=model, stream=False, think=False, keep_alive="5m",
                               options={"temperature": 0}, messages=[{"role": "user", "content": prompt}])).encode()
        req = urllib.request.Request("http://127.0.0.1:11434/api/chat", body, {"Content-Type": "application/json"})
        return json.load(urllib.request.urlopen(req, timeout=300))
    t0 = time.time()
    call("hi")
    load = round(time.time() - t0, 1)
    with Sampler() as idle:
        time.sleep(8)
    times = []
    with Sampler() as work:
        for _ in range(5):
            t = time.time()
            call("Pick one word from: status, dashboard, stop. The user said: how is ClipForge going?")
            times.append(round(time.time() - t, 2))
    subprocess.run(["ollama", "stop", model], capture_output=True)
    return dict(load_s=load, idle=idle.row(base), working=work.row(base), call_seconds_each=times,
                note="RAM/CPU here are the measuring script's, not Ollama's; use the graphics-memory number")


if __name__ == "__main__":
    which = sys.argv[1]
    base = gpu_mib()
    r = dict(part=which, gpu_baseline_mib=base)
    if which == "wake":
        r.update(part_wake(base))
    elif which.startswith("whisper-"):
        r.update(part_whisper(base, {"whisper-small": "small.en", "whisper-turbo": "large-v3-turbo"}[which]))
    elif which == "kokoro":
        r.update(part_kokoro(base))
    elif which == "chatterbox":
        r.update(part_chatterbox(base))
    elif which.startswith("ollama:"):
        r.update(part_ollama(base, which.split(":", 1)[1]))
    print(json.dumps(r))
    with open(os.path.join(HERE, "measure_results.jsonl"), "a") as f:
        f.write(json.dumps(r) + "\n")
