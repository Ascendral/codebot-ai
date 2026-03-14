#!/bin/bash
# Start CodeBot dashboard as a persistent background daemon
# Usage: ./bin/dashboard-start.sh

DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$HOME/.codebot/dashboard.pid"
LOGFILE="$HOME/.codebot/dashboard.log"

# Kill any existing dashboard
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null
  rm -f "$PIDFILE"
fi

# Ensure .codebot dir exists
mkdir -p "$HOME/.codebot"

# Start detached — survives terminal close
cd "$DIR"
nohup node bin/codebot --dashboard --provider ollama --model qwen3:14b \
  > "$LOGFILE" 2>&1 &

echo $! > "$PIDFILE"
disown

echo "Dashboard started (PID $(cat "$PIDFILE"))"
echo "  URL: http://127.0.0.1:3120"
echo "  Log: $LOGFILE"
echo "  Stop: kill \$(cat $PIDFILE)"
