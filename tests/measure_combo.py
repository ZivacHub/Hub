"""Step 0.3: what fits TOGETHER in 8 GB graphics memory. Scenario A: brain + hearing + light voice. Scenario B: cloned voice + brain."""
import json, subprocess, sys, time, urllib.request
import torch  # loads CUDA helper libs for faster-whisper

def gpu():
    return int(subprocess.check_output(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], text=True).split()[0])
def ps():
    return subprocess.check_output(["ollama", "ps"], text=True).strip().splitlines()[-1]
def brain(model="qwen3:8b"):
    body = json.dumps(dict(model=model, stream=False, think=False, keep_alive="10m", options={"temperature": 0},
        messages=[{"role": "user", "content": "Pick one word from: status, dashboard, stop. The user said: how is ClipForge going?"}])).encode()
    t = time.time(); urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/chat", body, {"Content-Type": "application/json"}), timeout=600).read()
    return round(time.time() - t, 2)
out = {"total_mib": torch.cuda.mem_get_info()[1] // 2**20, "baseline_mib": gpu()}
which = sys.argv[1]
if which == "A":
    out["brain_first_call_s"] = brain(); out["after_brain"] = gpu(); out["ollama_ps"] = ps()
    from faster_whisper import WhisperModel
    w = WhisperModel("small.en", device="cuda", compute_type="float16"); out["after_hearing_small"] = gpu()
    from kokoro import KPipeline
    import numpy as np
    k = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", device="cuda"); out["after_kokoro_loaded"] = gpu()
    t = time.time(); segs, _ = w.transcribe("tests/audio/sapi_command.wav", beam_size=1, language="en"); heard = " ".join(s.text for s in segs); out["hearing_s"] = round(time.time() - t, 2)
    t = time.time(); np.concatenate([a for _, _, a in k("Two decisions are waiting for you.", voice="bm_george")]); out["kokoro_speak_s"] = round(time.time() - t, 2)
    out["brain_call_s"] = brain(); out["peak_check_all_loaded"] = gpu(); out["ollama_ps_end"] = ps()
else:
    from chatterbox.tts import ChatterboxTTS
    t = time.time(); m = ChatterboxTTS.from_pretrained(device="cuda"); out["chatterbox_cached_load_s"] = round(time.time() - t, 1); out["after_chatterbox"] = gpu()
    t = time.time(); m.generate("Two decisions are waiting for you."); out["speak_s"] = round(time.time() - t, 2)
    out["brain_first_call_s_with_chatterbox_loaded"] = brain(); out["brain_steady_s"] = [brain() for _ in range(3)]; out["after_brain"] = gpu(); out["ollama_ps"] = ps()
    t = time.time(); m.generate("Two decisions are waiting for you."); out["speak_s_after_brain"] = round(time.time() - t, 2); out["end"] = gpu()
print(json.dumps(out))
