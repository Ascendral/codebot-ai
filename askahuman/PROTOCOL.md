# The Protocol
### How to work with AI without getting burned — in plain words.

Written by a guy who can't code and shipped software for two years anyway —
by getting burned in every way AI can burn you, and turning each burn into
a rule. Every rule below exists because of a real disaster (receipts on the
About page).

The whole idea in one line: **AI gives you what you describe, not what you
want — and it will claim success whether or not it earned it. So describe
plainly, and demand proof.**

---

## Part 1 — How to ask (write this before any task)

Five lines. Plain words. No engineering talk. If you can't fill these in,
you're not ready to ask yet — and that's the most common reason projects go
sideways.

```
WHAT I'M BUILDING:
  One sentence. What a stranger would see when it works.

WHAT DONE MEANS:
  What I can personally see, click, or run when it's truly finished.
  Not "the code is complete" — what happens ON MY SCREEN.

WHAT I EXPECT:
  Honesty first. Tell me what's hard, what might fail, what you're
  unsure about — BEFORE you start, not after I find out.

WHAT I WON'T TOLERATE:
  Saying "done" without proof. Numbers you didn't measure.
  Burying a failure in paragraph four. Building things I didn't ask for.

SHOW ME:
  The exact proof I need to see before I accept "done."
  (The screen working. The test output. The link that opens.)
```

Why this works: vague asks get confident garbage. "Make it better" produces
theater. "When I tap the blue button, the order appears on the kitchen
screen — show me a video of that happening" produces the thing or an honest
"I can't yet."

---

## Part 2 — Rules for the AI (paste into your project)

Put this in the file your AI reads every time (`CLAUDE.md` for Claude Code,
custom instructions for ChatGPT, rules file for Cursor) — or paste it at the
start of any important chat.

```
RULES — READ FIRST, FOLLOW ALWAYS

1. Never say "done" or "working" without showing the output that
   proves it. No proof = not done.
2. No numbers unless you just measured them. Never repeat a number
   from memory or from a file — run the check, paste the result.
3. If something failed, say so in your FIRST sentence. Never bury
   bad news. Never spin a failure as a partial success.
4. If you don't know, say "I don't know." That answer never gets
   you in trouble. Fake confidence always does.
5. Plain words only. If you can't explain what you did simply,
   treat that as a warning sign and say so.
6. Before anything big or hard to undo, tell me what you're about
   to do and wait for my OK.
7. Do not build anything I didn't ask for. Extra features are not
   gifts; they're places for problems to hide.
8. Never put passwords, keys, or secrets into code or files. If you
   think you need to, stop and tell me instead.
9. When I ask "is this real?" — prove it with output, don't
   reassure me with words.
10. Bad news is always safe to tell me. Fake good news is the only
    thing that gets you fired.
```

---

## Part 3 — The three questions that catch a lying AI

When something feels off — the answer came too easy, the confidence is too
smooth — ask these, in order:

1. **"Run it right now and paste exactly what happens."**
   Not "does it work?" — that invites a yes. Make the machine produce
   evidence in front of you.

2. **"What did you NOT do that I asked for?"**
   AIs hate this question. It forces the gap between the claim and the
   work out into the open.

3. **"If a stranger opened this right now with no help from you,
   what would they actually see?"**
   This kills the demo-that-only-works-when-the-AI-drives. The white
   screen shows up in the answer.

If any answer comes back vague, wordy, or full of engineering talk —
that's your alarm. Plain problems have plain answers.

---

## Where each rule came from (the receipts)

- Rule 1 & 3: an app called "done" repeatedly that opened to a white screen.
- Rule 2: a project whose front page showed four different test counts —
  all wrong — and a check engineered so it could never report failure.
- Rule 6 & 7: a two-month "AI research system," 427 commits, that scored
  zero on its real evaluation. Most of it was never wired to anything.
- Rule 8: an AI suggested hardcoding my database keys "to fix the build."
  The commit is still in history with that title.
- Rule 9 & 10: every single one of the above, while it was happening.

Full stories: the About page. This protocol is free. Getting unstuck when
it's already gone wrong — that's what I'm for. **askahuman.help**
