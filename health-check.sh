#!/bin/bash
CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null)
if [ "$CODE" != "200" ]; then
  cd $(dirname "$0")
  pkill -f "next start" 2>/dev/null
  sleep 2
  setsid npx next start -p 3020 -H 0.0.0.0 &>/tmp/next-prod.log &
fi
