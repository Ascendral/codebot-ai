# X / Twitter launch thread — CodeBot AI (v2.10.0)

Drafted 2026-04-17 against the repositioned product ("open-source autonomous coding agent with a cryptographic audit trail"). Previous CORD-focused thread replaced; CORD is now one component of CodeBot, not the product.

Posting cadence: Post #1 pinned, each subsequent post is a reply in the same thread. Best window: Tuesday/Wednesday 8–10 AM PT.

---

## POST 1 — hook + link (PIN THIS)

> I built an open-source coding agent where every action leaves a SHA-256 audit trail.
>
> Point it at a GitHub issue. Walk away. Come back to a tested PR — and a hash-chained log of exactly what the AI touched.
>
> MIT. Runs local (Ollama/LM Studio). No telemetry.
>
> npm install -g codebot-ai
>
> 🧵

*Image:* 30-second GIF — terminal showing `codebot --solve https://github.com/...`, then a rendered audit log entry with `prevHash` / `hash` / tool name visible.

---

## POST 2 — the problem

> Every AI coding tool today (Cursor, Copilot, Devin, Aider) is optimized for making *you* faster.
>
> None of them help you answer the question "what did the AI actually do to our codebase?"
>
> If you're at a regulated company — fintech, health, gov — that question isn't optional.

---

## POST 3 — the mechanism

> CodeBot logs every tool call as a hash-chained entry:
>
>     prevHash + { tool, args, result, timestamp, riskScore } → SHA-256
>
> Tamper with any entry, the chain breaks. `codebot audit verify <session>` re-hashes and tells you.
>
> SARIF 2.1.0 export pipes into your existing code-scanning dashboard.

*Image:* screenshot of 3–4 audit log entries as JSON with `prevHash` / `hash` highlighted.

---

## POST 4 — sovereignty

> Runs against whatever LLM *you* pick, with *your* API key:
>
> • Local: Ollama / LM Studio / vLLM
> • Cloud: Anthropic, OpenAI (incl. gpt-5.4), Google, DeepSeek, Groq, Mistral, xAI
>
> No CodeBot-hosted relay. Nothing phones home. Works on an air-gapped network.

---

## POST 5 — proof (SWE-bench)

> Real benchmark, not a demo:
>
> SWE-bench Verified, 50-task slice, full Docker harness: 17 resolved unattended (34.0%).
>
> Mid-tier-open-source range. Report + reproducible harness in the repo.
>
> This is proof the agent loop works end-to-end. Humans still review PRs — governance doesn't mean "trust the AI blindly."

---

## POST 6 — who it's for (and isn't)

> CodeBot is NOT a Cursor replacement. If you want tab-completion in your editor, Cursor is better.
>
> CodeBot is for:
> • Security-conscious teams that can't send code to 3rd-party AI
> • Regulated industries that need auditable AI actions
> • Solo builders running agent work unattended on long tasks

---

## POST 7 — the anti-Devin pitch (optional, post if engagement is strong)

> Devin is $500/month, closed-source, runs on servers you don't control.
>
> CodeBot is:
> • MIT-licensed
> • Runs on your machine (or your Ollama server)
> • Cryptographic audit on every action
> • Free
>
> Autonomous coding agents shouldn't require trusting a black box.

---

## POST 8 — CTA

> Try it:
>
>     npm install -g codebot-ai
>     codebot --setup
>     codebot --solve https://github.com/your/repo/issues/1
>
> Code: https://github.com/Ascendral/codebot-ai
> Docs: https://github.com/Ascendral/codebot-ai#readme
>
> Feedback, issues, PRs all welcome. I'm one person — every real user matters.

---

# Short one-off posts (not a thread)

Pick whichever fits the moment. Each is standalone, quotable, can be posted any day without setup.

### A. The category definition (use when someone confuses CodeBot with Cursor)

> CodeBot isn't an AI-enhanced editor. It's an autonomous coding agent with an audit log.
>
> Cursor makes *you* faster. CodeBot does work *while you're not there* — and tells you exactly what it did when you get back.
>
> Two different tools. Two different buyers.
>
> npm install -g codebot-ai

### B. The one-liner pitch

> Open-source autonomous coding agent with a cryptographic audit trail. Delegate the work. Verify every keystroke. MIT.
>
> npm install -g codebot-ai

### C. The InfoSec-angle post

> If your company won't let you use Copilot because "the code can't leave the network" — there's an MIT-licensed alternative now.
>
> CodeBot runs against local Ollama, logs every AI action as a hash-chained audit entry, exports SARIF for your CI.
>
> Your ops team can actually sign off on this one.

### D. The demo-result post (pair with the 30s video)

> `codebot --solve` on a random SWE-bench issue:
> • 44s to produce a 1.6 KB patch
> • All FAIL_TO_PASS tests pass in the official Docker harness
> • Full audit trail of which files were touched, in what order, by which tool
>
> This is what agentic coding looks like when the audit is not optional.

### E. The contrarian take

> Most AI coding tools ship without audit logs because their buyer — an individual developer — doesn't ask for one.
>
> That's going to age poorly the first time someone has to explain to regulators why they can't reconstruct what an AI agent did to production code.
>
> codebot-ai: we chose the buyer who asks.

### F. The sovereignty post

> Eight LLM providers supported. My key, not theirs. My endpoint, not theirs. My machine, or my Ollama.
>
> No CodeBot-hosted relay. Nothing phones home. Air-gapped if I want.
>
> That's the default. Not a paid tier.
>
> npm install -g codebot-ai

### G. The dry-humor / Codi-voice post

> Built an AI coding agent that runs tasks end-to-end, writes a cryptographic audit log of everything it does, runs on Ollama, and ships with zero telemetry.
>
> Not because I don't like telemetry. Because the class of user this is for already has opinions about telemetry.
>
> MIT. codebot-ai on npm.
