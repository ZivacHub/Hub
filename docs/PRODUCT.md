# Product: Hub
Status: CONFIRMED by Ivan on 2026-11-02 ("Yes, that's it"), with the five stated assumptions standing (voice decisions are appended after a read-back yes; unset-up projects show as "not set up"; idle listener kept tiny and measured; Manager started when needed; for Ivan alone). Changes here only with Ivan's OK, each with a dated line under "Changed".
This file is the compass: it is loaded at the start of every session. Keep it under 45 lines.

## The goal, in Ivan's own words
> "I want to build like a hub area for all of the projects where I can kind of look all of the responses from the cloud and kind of maintain them, everything from there, not ... necessarily from the app itself, but kind of have the overview of them all." (2026-11-01)
> "...integrate Jarvis ... that makes you, well, talk like a Jarvis from Iron Man." / "ClipForge, pull me this up, and he will pull up what he made, or ... post it" (2026-11-01)
> "He isn't a brain of all operations. He's just here to tell me when I ask him something ... He doesn't know. He doesn't need to know the answers. But he needs to know how to fetch them. That's the main" (2026-11-01)
> "I say heyy jarvis, he can respond and do tasks in background, but if I sayy pull out the dashboard he can boot the site" (2026-11-01)

## Who it's for and what problem it solves
- Only Ivan. One place (dashboard + voice) to see and steer all BUSNUS projects without opening each chat. Dashboard: "all projects, and there progresses, decisions waiting".

## Non-negotiables (decisions that must not drift)
- Jarvis fetches answers, it does not hold them: the data stays in each project (plan board, decisions, handoff, chat history files, the AI_Orcestration Manager). Read chat history files read-only; they stay on this PC.
- Brain: Gemini free API key in the cloud, Claude for delegated jobs, a small local model only as offline backup (D13, replaces "local model only"; Google may read free-tier prompts, Ivan accepted). No Anthropic API key (D2). Voice free, unlimited, cloned from a short sample (D3, D4 open: which voice).
- Nothing essential may depend on a paid tool.
- Runs as a web page on his PC; clean modern dashboard look; "Hey Jarvis" wake phrase; English only. Starts with Windows (Ivan's choice; keep the idle cost small and measure it).
- Never on its own: post or publish, spend money, delete or overwrite files, speak sensitive things aloud. Anything that changes something asks for a spoken yes first.
- Claude does the installs, Ivan clicks yes; tell him before big downloads (disk is 41 GB free).

## What success looks like
- "one glace tells me everything, I can boot it up and talk to it just fom myn voice" (Ivan).

## Priorities (Ivan, 2026-11-01)
- MUST (first versions): "Hey Jarvis" + spoken answers; ask project status by voice; open the dashboard by voice; answer decisions by voice (read back first).
- NICE LATER: dictate new ideas to notes; start or run work in projects (open the chat, or run quietly, per request); Jarvis-style personality ("a bit more vulgar"); ClipForge actions (pull up clips, post it).
- Biggest worries: it mishears and does the wrong thing; it slows his PC or games; the voice sounds robotic.

- REORDERED (Ivan, 2026-11-05): "lets focus on dashboard itself, so we can menage all projects from there, jarvis is an optional thing and probaly will not live up". The dashboard is now the main product; Jarvis/voice is optional and runs in its own chat. First page shows: project cards, all waiting decisions in one list, Claude's latest answer per project, the Manager card. Look only at first. Light and clean by default, with a dark mode switch.
- ALSO LATER (Ivan, 2026-11-03): "have overview of my messages, emails and such"; "the ability to boot up certain projects ... ask him, hey, what's going on there? And he will tell me, and then I can answer him. And then the Claude will continue working on the project with what I said." (Fits phases 4 and 7; messages/emails are new and not yet in the plan. Instagram has no official route for personal accounts; see docs/reference/PRIOR_ART.md.)

- NEW WISHES (Ivan, 2026-11-09; phases proposed, not yet approved): "I dont realy turn off my pc so it would be good if it could do its work, and when everything is done, basically turn off"; "a silent mode, so it doesn't waste our resources"; "an ability to overview all the tasks that is basically running by the Claude or the other projects"; if I'm in a game "lower all other tasks, so I can play my game normally, but still tasks are running, maybe one by one" with CPU, graphics card and memory percentage limits.

## Not doing (on purpose)
- No Anthropic API key, no paid voice, no other languages, no phone app or sharing, not a replacement for the AI_Orcestration Manager (it uses it).

## Changed
- 2026-11-07: the dashboard may also start/stop projects, open them in Claude Code, and (his ticks) start them with the PC (D23, D24, D25); this replaces "look only for now".
- 2026-11-05: dashboard first, Jarvis optional (Ivan's words above, D19, D20). The MUST list above (voice first) no longer sets the order; the plan is being re-ordered for his OK.
- 2026-11-01: created from Ivan's answers (D1 to D3 in DECISIONS.md).
- 2026-11-03: added to "also later": overview of messages and emails, and the loop "ask a project what is going on, answer it, Claude continues with the answer" (Ivan's words, after approving COMMANDS.md).
- 2026-11-02: brain changed from "local model only" to Gemini free key + Claude for delegated jobs + small local backup (D13), after Ivan: "Yes, that is it. Let's try to integrate that." He was told Google may use and read free-tier prompts and asks not to send personal information.
