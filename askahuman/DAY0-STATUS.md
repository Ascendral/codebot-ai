# Ask a Human — state as of end of Day 0 (2026-07-10)

## DONE — verified
- Site LIVE and human-confirmed loading:
  https://ascendral.github.io/codebot-ai/askahuman/
  (GitHub Pages, main branch, docs/askahuman/, build run 140 success)
- Stripe $49 payment link wired into the site (buy.stripe.com/5kQdRa4GFbim...)
- WhatsApp wired: wa.me/19254280026 with prefilled opener
- Domains owned: askahumanai.com (confirmed on Cloudflare NS),
  askahuman.help (bought, DNS not yet visible)
- Launch kit written + adversarially fact-checked: askahuman/LAUNCH-KIT.md
  (12 overclaims caught and corrected by the checker agents)
- Protocol page live + PROTOCOL.md + `npx askahuman` installer built
  (11/11 tests; NOT yet published to npm)
- agenttrail: 254/254 tests, field-validated on Alex's Mac

## TOMORROW — Alex, ~13 minutes total, in this order
1. Cloudflare redirect (3 min): dash.cloudflare.com → askahumanai.com →
   Rules → Redirect Rules → Create → All incoming requests →
   Redirect to Static → https://ascendral.github.io/codebot-ai/askahuman/
   → 301 → Deploy. Then verify askahumanai.com loads the site.
2. Walk the customer path once: tap WhatsApp button (chat reaches phone?),
   tap $49 button (Stripe checkout shows?).
3. Post reddit-claudeai from LAUNCH-KIT.md (corrected version) to r/ClaudeAI.
4. Post x-thread from LAUNCH-KIT.md, pin it.
5. THE CLOCK STARTS: 14 days, 3 paying strangers, per ONE_PLAN.md.
   Daily after: 2 DMs/day (template in kit), answer every thread fast.

## Parked (do NOT touch before the gate)
- npm publish of askahuman + agenttrail (nice, not blocking)
- askahuman.help DNS attach (when it becomes visible)
- footer YOUR-EMAIL placeholder on the live site
- Show HN + r/nocode posts (days 2-3 per LAUNCH.md)

## To resume with Claude from any session
Say: "read askahuman/DAY0-STATUS.md and continue" — everything is on
branch claude/assess-code-bot-ZKFgx (site also on main under docs/).
