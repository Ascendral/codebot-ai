# Ask a Human — Launch Plan

**Gate (locked before launch, per anti-theater protocol):** within 14 days of
the site going live with a working payment link — **3 strangers pay real
money** (any amount). Hit → build the intake system and scale. Miss → the
pitch changes, not two more years of building. "People seemed interested"
is a miss. 2 payers is a miss.

## The site

`askahuman/site/` — two pages, self-contained, no build step:
- `index.html` — offer, pricing ($49 / $199 / $499), how it works, honest FAQ
- `about.html` — Alex's bio via 6 transcript-verified AI disasters
  (long-form evidence: `docs/story/incidents.md`)

**Deploy:** any static host. Fastest: Cloudflare Pages or GitHub Pages —
point `askahuman.help` at it. No server, no database, nothing to break.

**Blockers, all Alex-only, all phone-doable:**
1. Buy `askahuman.help` + `askahumanai.com` (~$50/yr total)
2. Stripe Payment Link for "$49 Unstick session" → replaces
   `#PAYMENT-LINK-GOES-HERE` (2 spots in index.html)
3. WhatsApp Business number → replaces `WHATSAPP-OR-TEXT-NUMBER`
4. Contact email → replaces `YOUR-EMAIL` in the footer

## The offer, one paragraph (for posts/DMs)

> Stuck with AI? Talk to a human who's been there. I'm not an engineer —
> I can't code. I've still shipped working software for two years by making
> AI do the work, and getting burned in every way it can burn you (I
> published the receipts). Message me any hour: you usually get me directly;
> if I'm asleep, my AI answers in seconds and I follow up same day. $49 to
> get unstuck, and if I can't help, you don't pay.

## First 10 targets (post where the stuck people already are)

1. **r/ClaudeAI** — story post: "I can't code. I shipped software for 2
   years anyway. Here's every way AI lied to me" → link to About page.
   The incidents document IS the marketing.
2. **r/ChatGPTCoding** — same story, ChatGPT-flavored lead.
3. **r/nocode** — angle: "what to do when your no-code AI project breaks
   and you can't read the error."
4. **X/Twitter thread** — the 6 incidents as a thread, one per post,
   ending with the offer. Pin it.
5. **Hacker News (Show HN)** — "Show HN: I mined 2 years of my AI
   transcripts for every lie it told me." HN loves receipts and hates
   hype — the incidents doc is HN-native content.
6. **Indie Hackers** — build-in-public post: the pivot story (2 years
   building → 1 week to first service revenue?). IH rewards honesty arcs.
7. **TikTok/Reels/Shorts** — Alex on camera, 60s: "An AI told me my app
   was done. It was a white screen. For two years..." (reuse existing
   Remotion/video skills from the repo).
8. **Facebook small-business groups** — angle 3 (business owner whose
   "AI guy" is a chatbot that broke).
9. **Discord servers** (Cursor, Claude, bolt/lovable/v0 communities) —
   be helpful first, answer stuck-people questions free for a week,
   signature link. No spam.
10. **Direct DMs** — 20 people who post "AI ruined my project" complaints
    (search X/Reddit for exact phrases like "Claude deleted my code",
    "cursor broke my app"). Personal, short, no pitch beyond "I help
    with exactly this, here's my page."

## Sequencing

- Day 0: placeholders filled → deploy → domain live
- Day 1: targets 1 + 4 (Reddit story + X thread) — measure clicks
- Day 2-3: targets 5 + 6 if day-1 signal is decent
- Day 4-14: targets 7-10 as a drumbeat; 2 DMs per day minimum
- Day 14: count the payers. The number decides, not the mood.

## What we do NOT do before the gate

- No app, no portal, no AI intake bot (WhatsApp + human + ChatGPT-on-the-
  side is the v1 "system")
- No repo-cleanup detours, no new products, no rebrands
- No paid ads
