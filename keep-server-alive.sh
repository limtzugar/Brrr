#!/bin/bash
# Keep Next.js server alive - respawn if it dies
cd $(dirname "$0")
while true; do
  if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null | grep -q "200"; then
    echo "[$(date)] Server not responding, (re)starting..."
    pkill -f "next start" 2>/dev/null
    sleep 1
    npx next start -p 3020 &
    sleep 4
  else
    # Server is alive, just wait
    sleep 5
  fi
done
