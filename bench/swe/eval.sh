#!/usr/bin/env bash
#
# eval.sh — score a predictions.json file using the official SWE-bench harness.
#
# This is a thin wrapper. The actual scoring (Docker per task, apply patch,
# run tests, compute pass/fail) is all done by the official harness from
# princeton-nlp/SWE-bench. We do NOT reimplement scoring.
#
# Usage:
#   bash eval.sh predictions.json [run_id]
#
# Produces:
#   results-<run_id>.json — per-task pass/fail breakdown
#   logs/<run_id>/        — per-task logs from the harness
#

set -euo pipefail

PREDICTIONS="${1:-predictions.json}"
RUN_ID="${2:-codebot-$(date +%Y%m%d-%H%M%S)}"

if [ ! -f "$PREDICTIONS" ]; then
  echo "ERROR: $PREDICTIONS not found" >&2
  exit 2
fi

if ! command -v python >/dev/null 2>&1; then
  echo "ERROR: python not on PATH" >&2
  exit 2
fi

if ! python -c "import swebench" 2>/dev/null; then
  echo "ERROR: swebench not installed. Run:" >&2
  echo "  pip install -r requirements.txt" >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not on PATH. The official SWE-bench harness uses Docker per-task." >&2
  exit 2
fi

# The official harness expects:
#   --predictions_path  path to JSON list of {instance_id, model_name_or_path, model_patch}
#   --max_workers       parallelism — keep low to avoid Docker exhaustion
#   --run_id            tag for logs and results dir
#   --dataset_name      same dataset gen_predictions.py used
#
# See: https://github.com/princeton-nlp/SWE-bench/blob/main/docs/20240627_docker/README.md

DATASET="${SWEBENCH_DATASET:-princeton-nlp/SWE-bench_Verified}"

echo "# scoring $PREDICTIONS against $DATASET"
echo "# run_id: $RUN_ID"
echo "# (this will pull Docker images on first run; ~2-5 GB total per dataset)"

python -m swebench.harness.run_evaluation \
  --predictions_path "$PREDICTIONS" \
  --max_workers 2 \
  --run_id "$RUN_ID" \
  --dataset_name "$DATASET"

echo ""
echo "# results dir: ./logs/run_evaluation/$RUN_ID/"
echo "# summary:     ./logs/run_evaluation/$RUN_ID/codebot-ai-2.10.0/<dataset>/report.json"
