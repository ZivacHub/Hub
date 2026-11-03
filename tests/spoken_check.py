"""Step 2.5: compare what Jarvis would SAY about a project with the project's own files, counted a second, independent way
(plain regexes on docs/plan/BOARD.md and docs/DECISIONS.md, not the shared library).

  python tests/spoken_check.py [project folder names...]     default: Hub, Game, Socials Automatisation
"""
import re
import subprocess
import sys

ROOT = r"C:\Users\Ivan\Desktop\BUSNUS"
HERE = r"C:\Users\Ivan\Desktop\BUSNUS\Hub\tools\hub_status\status.mjs"
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}


def read(p):
    try:
        return open(p, encoding="utf-8-sig").read()
    except OSError:
        return ""


def board(name):
    text = read(rf"{ROOT}\{name}\docs\plan\BOARD.md") or read(rf"{ROOT}\{name}\PLAN.md")
    m = re.search(r"^##\s+Status board[^\n]*\n(.*?)(?=^##\s|\Z)", text, re.S | re.M)
    phases, cur = [], None
    for line in (m.group(1) if m else "").splitlines():
        t = re.match(r"^- \[( |~|x|-)\]\s+(.+?)\s*$", line)
        s = re.match(r"^\s{2,}- \[( |~|x|-)\]\s+(.+?)\s*$", line)
        if t:
            cur = {"mark": t.group(1), "title": t.group(2), "steps": []}
            phases.append(cur)
        elif s and cur:
            cur["steps"].append((s.group(1), s.group(2)))
    return phases


def waiting(name):
    text = read(rf"{ROOT}\{name}\docs\DECISIONS.md") or read(rf"{ROOT}\{name}\DECISIONS.md")
    return len([l for l in text.splitlines() if re.match(r"^#{2,3}\s+(D|Q)\d+", l) and re.search(r"\[(open|proposed)", l, re.I)
                and not re.search(r"superseded", l, re.I)])  # a decision marked superseded is no longer waiting


def check(name):
    spoken = subprocess.run(["node", HERE, "project", name], capture_output=True, text=True, encoding="utf-8").stdout.strip()
    phases = board(name)
    real = [p for p in phases if p["mark"] != "-"]
    steps = [s for p in phases for s in p["steps"] if s[0] != "-"]
    done_steps = sum(1 for s in steps if s[0] == "x")
    now = next((p for p in real if p["mark"] in " ~"), None)
    nxt = next((s for s in now["steps"] if s[0] in " ~"), None) if now else None
    errs = []
    m = re.search(r"on phase (\S+?) of (\d+)", spoken)
    if now:
        own = re.match(r"Phase\s+([A-Za-z0-9.]+)", now["title"])
        if not m or (own and m.group(1).rstrip(",") != own.group(1)) or int(m.group(2)) != len(real):
            errs.append(f"phase: spoken {m.groups() if m else None}, files say {own.group(1) if own else '?'} of {len(real)}")
    m = re.search(r"(\d+) of (\d+) steps are done, about (\d+) percent", spoken)
    pct = round(100 * done_steps / len(steps)) if steps else None
    if not m or (int(m.group(1)), int(m.group(2)), int(m.group(3))) != (done_steps, len(steps), pct):
        errs.append(f"steps: spoken {m.groups() if m else None}, files say {done_steps} of {len(steps)}, {pct} percent")
    if nxt:
        want = re.split(r"\s+[—–-]\s+", nxt[1])[0][:25].strip()
        if want not in spoken:
            errs.append(f"next step: '{want}' not in the spoken text")
    n = waiting(name)
    w = re.search(r"(no|one|two|three|four|five|six|seven|eight|nine|ten) decisions? (?:are|is) waiting", spoken, re.I)
    spoken_n = 0 if not w or w.group(1).lower() == "no" else WORDS[w.group(1).lower()]
    if spoken_n != n:
        errs.append(f"decisions waiting: spoken {spoken_n}, files say {n}")
    print(("OK   " if not errs else "FAIL ") + name + ("" if not errs else ": " + "; ".join(errs)))
    print("     said: " + spoken[:230])
    return not errs


names = sys.argv[1:] or ["Hub", "Game", "Socials Automatisation"]
sys.exit(0 if all([check(n) for n in names]) else 1)
