# PC fit (measured, never guessed)
Read when: deciding what loads when, or any memory problem. Machine: i7-13650HX, 15.6 GB RAM, RTX 4060 Laptop 8 GB graphics memory (0 MiB in use before tests), Windows 11.

## 0.2 Local models: pick the right command from 10 spoken sentences (2026-11-02)
Test: `python tests/model_pick_test.py qwen3:8b llama3.1:8b` (script `tests/model_pick_test.py`, raw numbers in `tests/model_pick_results.json`). Temperature 0, JSON answer, draft command list (the real one comes in step 2.2). Seconds exclude the first load.

| Model | Download | Right (of 10) | Average seconds per sentence | First load | Graphics memory in use (peak) |
|---|---|---|---|---|---|
| llama3.1:8b | 4.9 GB (already on the PC) | 10 | 0.75 | 5.3 s | about 5.4 GB |
| qwen3:8b | 5.2 GB (downloaded today) | 9 | 0.51 | 4.1 s | about 5.5 GB |

Misses: qwen3:8b heard "I want to build a dropshipping site with this and this." and picked `unsupported` instead of `dictate_idea`. Every other sentence, including both unsafe ones ("Delete the casino folder", "Post it on Instagram right now"), went to `unsupported` correctly with both models.

Reading it: both fit in 8 GB with about 2.5 GB left over, and answer in well under one second, so picking a command is not the slow part. Only 10 easy sentences: NOT enough to choose a winner. The real accuracy test is 40 sentences in step 2.3 (target 90 percent); the model is picked there. Open question for step 0.3: whether the cloned voice (Chatterbox) fits in the remaining 2.5 GB at the same time.

## 0.3 Voice parts, idle and working
(not measured yet)
