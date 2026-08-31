#!/bin/bash
while true; do
  if ! curl -s -m 2 -o /dev/null http://localhost:3020 2>/dev/null; then
    echo "$(date): Server down, restarting..."
    cd $(dirname "$0")
    pkill -f "server.js" 2>/dev/null
    sleep 1
    nohup node .next/standalone/server.js -p 3020 > /tmp/server.log 2>&1 &
    sleep 3
    if curl -s -m 2 -o /dev/null http://localhost:3020 2>/dev/null; then
      echo "$(date): Server restarted OK"
    else
      echo "$(date): Server restart FAILED"
    fi
  fi
  sleep 10
done
