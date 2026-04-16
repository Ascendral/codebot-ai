# SWE-bench harness

Wraps the official [SWE-bench](https://github.com/princeton-nlp/SWE-bench) evaluation around CodeBot's `--solve`. Produces a real, leaderboard-comparable pass-rate number on a published benchmark.

## Why this exists

Per `docs/gtm/README.md` Phase 0 task #3, we need a published benchmark number. "8-phase pipeline" is not data; "X out of 50 SWE-bench Verified tasks solved end-to-end" is data. Without a number we have nothing to anchor a content post on.

## Approach

We do NOT reimplement the SWE-bench evaluation harness. The official one runs each task in a Docker container with the repo at the right commit, applies our patch, and runs the test suite. That's the gold standard — anything else is unreliable.

What we DO own:

1. `gen_predictions.py` — for each task, clone repo at base commit, invoke CodeBot's CLI on the problem statement, capture the resulting git diff, save to `predictions.json`
2. `eval.sh` — wrapper around the official harness that scores `predictions.json`
3. `summarize.py` — turn the harness output into a markdown table for the blog post

## Requirements

- Python 3.10+
- Docker (the official harness uses isolated containers per task)
- ~50 GB free disk for the SWE-bench dataset + Docker images
- An LLM API key (we'll use whatever is in `~/.codebot/config.json`)

Install:
```
cd bench/swe
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run a single task (smoke test, ~2-5 min)

```
source .venv/bin/activate
python gen_predictions.py \
  --dataset princeton-nlp/SWE-bench_Verified \
  --instance-ids astropy__astropy-12907 \
  --output predictions.json
```

Expected output:
- `predictions.json` containing `[{"instance_id": "...", "model_patch": "..."}]`
- Console log showing CodeBot's tool calls during the solve

Then score:
```
bash eval.sh predictions.json
```

## Run the Verified subset (50 tasks, ~3-8 hours, $200-500)

```
python gen_predictions.py \
  --dataset princeton-nlp/SWE-bench_Verified \
  --max-instances 50 \
  --output predictions-verified-50.json
bash eval.sh predictions-verified-50.json
python summarize.py predictions-verified-50.json results-verified-50.json \
  > ../../docs/benchmarks/swe-bench-verified-2026-04.md
```

## Run the full Verified set (500 tasks, ~30-80 hours, $2-5K)

Same command, drop `--max-instances`. **Don't run this until the 50-task subset has produced a meaningful number** (>5% pass rate). If the small run is at 0%, the bug is in the harness or the prompt, not in CodeBot.

## Honest scope warnings

- Each task takes 5-30 min wall time (LLM calls + Docker test runs). 50 tasks ≈ 5-25 hours.
- Cost depends on which model — GPT-5.4 is the default if `~/.codebot/config.json` has `openaiApiKey`. Override with `--model claude-haiku-4-5` for ~10x cheaper.
- Some tasks will time out. The harness records them as failures. That's fine; the leaderboard counts wall-clock failures the same way.
- The published number must include: which model, which dataset (Verified vs Lite vs Full), how many tasks attempted, how many passed, total cost, total wall time. Anything less is theater. See `summarize.py` for the required output schema.

## Where the numbers go

After a meaningful run:

1. Raw predictions and harness results stay in `bench/swe/runs/<date>/`
2. Markdown summary lands in `docs/benchmarks/swe-bench-<dataset>-<date>.md`
3. README hero section in the project root gets updated with the headline number
4. The summary becomes the spine of a blog post (per `docs/gtm/README.md` §4b)

## What's NOT shipped yet

- `gen_predictions.py` ships with this commit and runs end-to-end on 1 instance.
- `eval.sh` and `summarize.py` ship as scaffolds — they invoke the official harness which must be `pip install`ed first; user runs them after `pip install -r requirements.txt`.
- The actual run on real data requires (a) one-time Docker setup and (b) API budget. Neither is automated; both are manual decisions Alex makes when he's ready.
