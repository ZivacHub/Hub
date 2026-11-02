# Phase 1 — Ears and mouth
Board: docs/plan/BOARD.md lists this phase's steps and ticks. This file holds the detail. A pickup reads only the CURRENT phase's file.

## Purpose in plain words
Jarvis can hear "Hey Jarvis", hear what you say after it, and talk back in a cloned voice you picked by listening. At the end you say "Hey Jarvis, testing" and he answers aloud, repeating what he heard. He doesn't do any tasks yet.

## Read first (when working on this phase)
- docs/reference/PC_FIT.md (what fits together in memory)
- docs/DECISIONS.md (D3, D4, D7)

## Steps
**1.1 "Hey Jarvis" wake-phrase test** — Grade: standard (library with a clear way to test). Use: openWakeWord. Done when: a test that you say "Hey Jarvis" 20 times at normal distance and talk or play a video for 20 minutes counts how many times it woke (target: at least 18 of 20, at most 1 false wake in 20 minutes). Test: the counts printed from a recorded run. Decisions needed: none (if it fails, a new decision about another phrase).
**1.2 Speech-to-text test** — Grade: standard. Use: faster-whisper (small English model first). Done when: you say 10 sample command sentences and the text is printed correctly for at least 9. Test: the 10 sentences and what was heard in a table. Decisions needed: none.
**1.3 Voice test page: actor-style, butler-style, Kokoro** — Grade: strong (taste, and the sample source is Ivan's call). Use: Chatterbox-TTS-Server (its test page), Kokoro. Done when: Ivan can click and hear the same three sentences in (a) the film-style Jarvis voice from a sample he supplies or approves, (b) a licence-free butler-style sample, (c) Kokoro's fixed voice. Test: Ivan listened. Decisions needed: D4 (private use only for the film-style option; nothing is published).
**1.4 Ivan picks the voice (closes D4)** — Grade: strong (his decision). Use: choice card. Done when: D4 is `[decided]` with his words and the chosen sample is saved in `voices/` with a note of where it came from. Test: DECISIONS.md D4 shows decided. Decisions needed: D4.
**1.5 First loop: wake, listen, repeat back aloud** — Grade: standard (puts the tested parts together as the small program of D5). Use: Python. Done when: "Hey Jarvis, testing one two three" gets a spoken "I heard: testing one two three". Test: a recording or screen log of three tries and the time from end of speech to start of reply (target: under 3 seconds). Decisions needed: none.

## Risks and open points (only for this phase)
- A cloned voice from a short sample can sound robotic or slip in accent; that is why Ivan hears it before choosing.
- A film-actor voice is for private use on this PC only; never published or put in anything public (D4).

## Phase gate record
- Plain-words preview shown: 2026-11-02. Skills/repos search: PRIOR_ART.md (the four D7 parts, nothing new except the tiny sound package `sounddevice`). Decisions asked: D11 (microphone, voice-sample source); D4 stays for step 1.4. The owner's go: 2026-11-02 ("Yes, start Phase 1").
