"""Show what Gemini says with the relay's personality: exact answer first, a dry remark only when the dice allow it.
Uses Jarvis's real system prompt (tests/_jarvis_prompt.txt) rewritten by the relay, and a real status sentence from
tools/hub_status. Talks to Google directly (key read in-process, never printed); nothing is spoken.

  python tests/persona_samples.py            prints samples for 4 situations, remark forced on and off
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "tools", "jarvis_trial"))
import gemini_latency as g
import gemini_relay as r

PROMPT = open(os.path.join(HERE, "_jarvis_prompt.txt"), encoding="utf-8").read() + "\n[Context: Tuesday, 12:00, Zagreb]"
MODEL = g.cfg["llm_chat_model"]


def hub(*args):
    return subprocess.run(["node", os.path.join(HERE, "..", "tools", "hub_status", "status.mjs"), *args],
                          capture_output=True, text=True, encoding="utf-8").stdout.strip()


def tool_turn(user, tool, args, result):
    """The tool result is pasted into the user message: real function-call history needs Gemini 3 'thought signatures',
    which only Jarvis's own flow carries. Good enough to judge the wording of the final answer."""
    return [{"role": "user", "content": f"{user}\n\n[Result of {tool}({json.dumps(args)}): {result}]"}]


status = hub("project", "ClipForge")
projects = hub("list")
SCENARIOS = {
    "status question": tool_turn("Jarvis, how is ClipForge going?", "hub__project_status", {"project": "ClipForge"}, status),
    "plain chat": [{"role": "user", "content": "Jarvis, how are you today?"}],
    "same question again": [{"role": "user", "content": "Jarvis, what is two plus two?"},
                            {"role": "assistant", "content": "Four, sir."},
                            {"role": "user", "content": "Jarvis, what is two plus two?"}],
    "old unanswered question": [{"role": "user", "content": "Jarvis, what is the weather in Zagreb tomorrow?"}] +
                               tool_turn("Jarvis, which projects do I have?", "hub__list_projects", {}, projects),
}


def ask(messages, remark_on):
    r.BANTER_PCT = 100 if remark_on else 0
    body = {"model": MODEL, "max_tokens": 200, "temperature": 0.9,
            "messages": [{"role": "system", "content": PROMPT}] + messages}
    body, changed = r.rewrite_body(body)
    assert changed
    for m in (MODEL, "gemini-3.1-flash-lite"):
        body["model"] = m
        s, t, d = g.call("/chat/completions", body, timeout=45)
        if d:
            return (d["choices"][0]["message"].get("content") or "").strip(), t
    return "(no answer: Google too slow)", 0


if __name__ == "__main__":
    n_on = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    for name, msgs in SCENARIOS.items():
        print(f"\n=== {name}")
        txt, t = ask(msgs, False)
        print(f"  [no remark, {t:.1f}s] {txt}")
        for i in range(n_on):
            txt, t = ask(msgs, True)
            print(f"  [remark allowed #{i+1}, {t:.1f}s] {txt}")
