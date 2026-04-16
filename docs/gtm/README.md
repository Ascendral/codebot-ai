# CodeBot AI — Go-to-Market Plan

**Owner:** Alex Pinkevich (solo)
**Started:** 2026-04-15
**Time budget:** 10 hours/week
**Money budget:** ≤ $100/month
**Network in target buyers:** none

This plan is constrained by reality, not aspiration. If the numbers below don't materialize by the dates given, we kill or pivot. No theater.

---

## 1. Day-0 baseline (locked, never edit)

Pulled live from GitHub + npm on 2026-04-15. Every future weekly report compares to these numbers.

| Metric | Day-0 value |
|---|---|
| GitHub stars | **2** |
| Forks | 0 |
| GitHub Pages views (14d) | 11 (9 unique) |
| Repo clones (14d) | 473 / 101 unique |
| DMG downloads, all releases | 1 (v2.9.0) |
| npm downloads (30d) | 320 (~10/day) |
| Telemetry-verified active installs | 0 (telemetry doesn't exist yet) |
| Inbound conversations | 0 |
| Paying customers | 0 |
| MRR | $0 |

---

## 2. Hypothesis we are testing

**Open-source AI coding agent with built-in governance (CORD safety engine + SARIF audit log + fully local LLM support) is a real moat for security-conscious developers and regulated-industry teams.** Building distribution through open-source community + content first will produce inbound enterprise interest by month 6 and one paying customer by month 9.

If this hypothesis is wrong, the most likely failure modes are:
- (a) The "governance" angle doesn't differentiate enough — devs pick Cursor/Copilot regardless
- (b) Open-source motion takes longer than 6 months to compound
- (c) Regulated buyers don't trust a solo-founder MIT project no matter how good the audit log is
- (d) The product still has too many rough edges to retain users who do try it

The plan checks for each of these at specific decision gates (§7).

---

## 3. 12-month targets (stretch but not delusional)

| Month | Stars | Active installs (telemetry) | Inbound convos | Paying customers | MRR |
|---|---|---|---|---|---|
| 0 (today) | 2 | 0 | 0 | 0 | $0 |
| 1 | 50 | 25 | 0 | 0 | $0 |
| 3 | 200 | 100 | 1 | 0 | $0 |
| 6 | 500 | 250 | 5 | 1 (pilot/free) | $0 |
| 9 | 1,000 | 500 | 10 | 1 (paid) | $5K |
| 12 | 2,000 | 1,000 | 20 | 3-5 | $15-25K |

For comparison: PostHog took ~9 months to hit 1K stars. Sentry took ~18. Cal.com hit 1K on a single big HN launch. These are reachable for a strong solo founder; they are not guaranteed.

---

## 4. Three motions running in parallel (~3 hrs/week each)

### 4a. Open source distribution (3 hrs/week)
- **Get on awesome lists:** awesome-cli-apps, awesome-self-hosted, awesome-electron, awesome-developer-tools, awesome-ai-coding
- **Show HN launch** of v2.10.0 once telemetry + SWE-bench number are ready
- **Reddit posts** in /r/programming, /r/selfhosted, /r/devops, /r/MachineLearning (one per month, not spam)
- **Polish first-run experience** — first 60 seconds matter more than any feature; new users who hit a wall in first install are gone forever
- **README is the landing page:** keep stars number live, add "Featured on HN/PH/etc." badges as they happen, lead with the differentiator (governance), not the feature list

### 4b. Content (3 hrs/week)
One deep technical post every 2 weeks. **Topics ranked by likely traction:**

1. "We ran SWE-bench on 8 LLMs, here's what they cost and how they ranked" (data post → HN front page material)
2. "Why your security team will never approve Copilot, and what to do about it" (positioning post)
3. "AI coding agents and SOC 2 / HIPAA: what auditors actually ask" (compliance post — niche but exactly your buyer)
4. "Building a constitutional safety engine for AI agents" (technical deep-dive on CORD)
5. "The audit log is the product" (philosophical/positioning)
6. "How we got from 2 stars to 500" (when applicable; meta posts work on HN)

Cross-post: dev.to (free distribution), Hacker News (organic), LinkedIn (your network of 1), Twitter/X.

**Not doing:** SEO long-tail (too slow with 0 backlinks), paid ads (no budget), influencer marketing (no money).

### 4c. Targeted outbound + telemetry (4 hrs/week)
- **Build telemetry first** (week 1-2). Without it, the rest of this plan is blind. Specs in §6.
- **5 LinkedIn DMs/day = 25/week.** Not spam — handcrafted, targeting Heads of AppSec / Engineering at mid-size regulated companies. **Goal is discovery, not selling.** Use the Mom Test (§5b).
- **No Apollo, no Sales Nav** — those cost money. Manually search LinkedIn (free), filter to relevant companies/titles, write personalized first messages.

---

## 5. Phase 0 — Foundation (Week 1, this week)

Concrete tasks, in order. Each box ticked or it doesn't count.

- [ ] **Telemetry shipped to main** — opt-in by default, easy opt-out, daily ping with version + OS + active flag. See §6 for spec.
- [ ] **`stats.codebot.ai` live** — public dashboard showing total installs, daily active, version distribution. Cloudflare Worker + KV. Use existing Cloudflare account.
- [ ] **SWE-bench Verified pilot run** — 50 tasks, 1 model (claude-sonnet-4-6), publish raw results to `docs/benchmarks/swe-bench-verified-2026-04.md`. Cost: ~$200-500 in API credits. **Score does not need to be high — it needs to be REAL.**
- [ ] **`docs/COMPLIANCE.md`** — map CORD risk dimensions to SOC 2 CC8.1, HIPAA §164.312, NIST 800-53 controls. Not aspirational; map what actually exists today.
- [ ] **README hero rewrite** — drop "any developer," lead with "AI coding agent your security team will approve."
- [ ] **`docs/gtm/this-week.md` created** — gets updated every Sunday with this week's targets and last week's results.
- [ ] **`docs/gtm/metrics.csv` row added** — week 16 baseline.

If Phase 0 is not complete by **Sunday 2026-04-19**, the rest of the plan slides one week. Don't pretend; reschedule honestly.

### 5a. LinkedIn DM template (cold)

```
Hi {Name} —

Saw you're {role} at {company}. I'm building an open-source AI coding
agent (codebot-ai on GitHub) that's specifically designed to satisfy
security review — full SARIF audit log, on-prem-capable, no code shipped
to OpenAI/Anthropic by default.

Not pitching anything. I'm trying to learn what would have to be true for
your security team to actually approve a tool like this. 15 minutes by
Zoom this week or next?

— Alex
```

Rules:
- Real first message, never a template-on-template followup
- If they don't reply in 7 days, ONE bump, then drop
- Track every send + reply + call in `docs/gtm/discovery-targets.csv`

### 5b. Discovery call questions (Mom Test, do not skip)

For each call, prepared list:

1. "Walk me through the last time your team had to approve or reject an AI coding tool. What happened?"
2. "Who was the most skeptical person in that decision? What were they worried about?"
3. "If they had said yes, what would have had to change about the tool?"
4. "What does your team use for code-related compliance evidence today? (SAST, SCA, SBOM, audit logs)"
5. "If a vendor showed up tomorrow with a tool that satisfied all your concerns, what would you need to see in the first 30 minutes to take it seriously?"
6. "Who else should I be talking to?" (always ask — every call must produce another lead)

**Do not pitch CodeBot during discovery calls.** You are learning. If they ask what you're building, give 30 seconds and steer back to their world. Notes in `docs/gtm/discovery-notes/{date}-{company}.md`.

---

## 6. Telemetry spec (week 1-2 build)

**Why:** without numbers, we cannot tell whether anything is working. Without opt-in default, the numbers will be too small to mean anything.

**What:**
- Config file: `~/.codebot/telemetry.json` with `{"enabled": true, "installation_id": "<uuid>"}`
- First-run prompt explains: anonymous, can disable with `codebot --telemetry off`, links to privacy doc
- Daily ping POST to `https://stats.codebot.ai/api/ping` with body:
  ```json
  {
    "installation_id": "<sha256(uuid + day) — rotates daily, can't track across days>",
    "version": "2.10.0",
    "os": "darwin-arm64",
    "node": "20.x",
    "first_seen_week": "2026-W16",
    "active_today": true,
    "tools_used_today": ["browser","git","docker"],
    "models_configured": ["anthropic","local"]
  }
  ```
- Server: Cloudflare Worker (free tier) + Cloudflare KV (free tier ≤ 100K reads/day) + a `stats.codebot.ai` static page that fetches aggregates
- Privacy: rotating per-day installation_id means we can count daily-active without tracking users
- Public dashboard at `stats.codebot.ai`: total installs ever, daily active, weekly active, version distribution, tools-used distribution

**Out of scope (intentionally):** error reporting (separate problem), individual tool calls (privacy nightmare), session replay (no), user identity (no, ever)

---

## 7. Decision gates (kill conditions)

If the metric on the left is below the value on the right at the date given, **stop and pivot or stop and rest**. Do not "keep pushing." This plan is falsifiable.

| Date | Metric | Kill if below |
|---|---|---|
| 2026-04-22 (1 week) | Phase 0 tasks complete | < 5 of 7 (and have honest reason for misses) |
| 2026-05-15 (1 month) | GitHub stars | < 25 |
| 2026-05-15 (1 month) | Telemetry-verified active installs | < 10 |
| 2026-06-15 (2 months) | LinkedIn DM reply rate | < 3% (3 replies per 100 DMs) |
| 2026-07-15 (3 months) | Inbound conversations | 0 |
| 2026-09-15 (5 months) | Real pilot user (using daily) | 0 |
| 2026-12-15 (8 months) | Paying customer | 0 |
| 2027-04-15 (1 year) | MRR | < $5K |

If a gate fails:
1. Write a postmortem in `docs/gtm/postmortems/{date}-{gate-name}.md`
2. Decide: pivot the motion (try different niche/channel/positioning) OR halt and reassess strategy
3. Do NOT just push the date out without changing the approach

---

## 8. Anti-theater rules for THIS plan

- Every metric in `metrics.csv` is pulled from a real source (GitHub API, npm, telemetry server). Never typed by hand.
- Every "inbound conversation" is a row in `discovery-targets.csv` with a real name and company, or it doesn't count.
- Every "pilot" is a real user with telemetry pings AND a Slack DM trail. Not a "prospect that said they're evaluating."
- Every "paying customer" is bank-confirmed money received. Not a verbal yes, not an LOI, not a Stripe authorization.
- Weekly log is updated EVERY Sunday whether the week was good or bad. Bad weeks are more important to record than good ones.
- If a tactic doesn't move the metric in 4 weeks, replace the tactic — don't double down on it because "it should work."

---

## 9. What this plan is NOT

- Not an enterprise sales motion (no budget, no network, no ARR target above $25K year 1)
- Not a fundraising plan (not pre-revenue raising; do that only if hypothesis validates)
- Not a hiring plan (solo for at least year 1)
- Not a feature roadmap (separate document; product changes are driven by user feedback, not aspiration)
- Not pivot bait (if niche fails per §7, kill and write postmortem; don't reflexively pivot to a new shiny narrative)
- Not "build it and they will come" (every metric demands distribution work, not just shipping code)

---

## 10. Files in this directory

- `README.md` (this) — strategic plan, locked baseline, decision gates
- `metrics.csv` — weekly numbers, append-only
- `this-week.md` — what's happening this week, updated every Sunday
- `discovery-targets.csv` — every cold outreach, with status
- `discovery-notes/` — call notes per company per date
- `postmortems/` — when a decision gate fails, why
- `benchmarks/` — published benchmark results (SWE-bench etc.)

---

## 11. The honest founder reality

Alex is 46, solo, no funding, paying for everything out of pocket. KlomboAGI is the more ambitious project but is years from revenue. CodeBot is shipped and could earn money — but only if distribution works.

10 hours per week = ~520 hours over 12 months. If those 520 hours produce zero paying customers, **the answer is not "Alex didn't try hard enough."** It's that the niche/positioning/motion is wrong, and the right move is to stop and rethink — not to grind another 520 hours hoping it gets better.

This plan exists to make sure 520 hours produces a clear answer, either way.
