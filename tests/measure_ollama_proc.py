"""Step 0.3 addendum: RAM and processor of the Ollama processes themselves, model loaded (idle) and answering."""
import json, sys, time, urllib.request, psutil

model = sys.argv[1]
def ollama_procs():
    return [p for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower().startswith("ollama")]
def call():
    body = json.dumps(dict(model=model, stream=False, think=False, keep_alive="5m", options={"temperature": 0},
        messages=[{"role": "user", "content": "Pick one word from: status, dashboard, stop. The user said: how is ClipForge going?"}])).encode()
    urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/chat", body, {"Content-Type": "application/json"}), timeout=300).read()
call()
ps = ollama_procs()
for p in ps: p.cpu_percent(None)
time.sleep(8)
idle_cpu = sum(p.cpu_percent(None) for p in ps)
idle_ram = sum(p.memory_info().rss for p in ps) / 2**20
for p in ps: p.cpu_percent(None)
t = time.time()
for _ in range(5): call()
work_cpu = sum(p.cpu_percent(None) for p in ollama_procs() if p in ps)
work_ram = sum(p.memory_info().rss for p in ollama_procs()) / 2**20
print(json.dumps(dict(model=model, idle_ram_mib=round(idle_ram), idle_cpu_one_core_pct=round(idle_cpu, 1),
    working_ram_mib=round(work_ram), working_cpu_one_core_pct=round(work_cpu, 1), procs=len(ps))))
