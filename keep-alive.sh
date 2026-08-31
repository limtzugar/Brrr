#!/bin/bash
# ─── Dip Hunter Keep-Alive Watchdog ─────────────────────────────────────
# Checks every 10s if Next.js dev server responds on port 3020.
# If not, kills stale processes and restarts.
# PID file: /tmp/next-dev.pid
# Log file: /tmp/next-dev.log

PORT=3020
PID_FILE=/tmp/next-dev.pid
LOG_FILE=/tmp/next-dev.log
PROJECT_DIR=$(dirname "$0")
MAX_RESTARTS=5
RESTART_COUNT=0
RESTART_WINDOW=60  # seconds — reset counter after this

echo "[$(date)] Watchdog started — monitoring port $PORT" >> "$LOG_FILE"

while true; do
  # Check if server responds
  if curl -sf -o /dev/null -m 5 "http://localhost:$PORT" 2>/dev/null; then
    # Server is healthy — reset restart counter
    RESTART_COUNT=0
    sleep 10
    continue
  fi

  # Server not responding
  echo "[$(date)] Server down — attempting restart (#$((RESTART_COUNT+1)))" >> "$LOG_FILE"

  # Kill existing processes on port
  fuser -k "$PORT/tcp" 2>/dev/null
  lsof -ti :"$PORT" | xargs kill -9 2>/dev/null

  # Also kill via PID file if exists
  if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    kill -9 "$OLD_PID" 2>/dev/null
    rm -f "$PID_FILE"
  fi

  sleep 2

  # Restart limit check
  RESTART_COUNT=$((RESTART_COUNT + 1))
  if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS" ]; then
    echo "[$(date)] FATAL: $MAX_RESTARTS restarts in $RESTART_WINDOW seconds — giving up" >> "$LOG_FILE"
    exit 1
  fi

  # Start server
  cd "$PROJECT_DIR"
  nohup npx next dev --port "$PORT" >> "$LOG_FILE" 2>&1 &
  NEW_PID=$!
  echo "$NEW_PID" > "$PID_FILE"
  echo "[$(date)] Started Next.js PID=$NEW_PID" >> "$LOG_FILE"

  # Wait for server to become ready
  for i in $(seq 1 20); do
    sleep 2
    if curl -sf -o /dev/null -m 5 "http://localhost:$PORT" 2>/dev/null; then
      echo "[$(date)] Server ready after $((i*2))s" >> "$LOG_FILE"
      RESTART_COUNT=0  # Reset on successful start
      break
    fi
  done

  sleep 10
done
