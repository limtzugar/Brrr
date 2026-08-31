#!/bin/bash
while true; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null)
  if [ "$CODE" != "200" ]; then
    pkill -f "next start" 2>/dev/null
    sleep 2
    cd /home/z/my-project
    npx next start -p 3020 -H 0.0.0.0 &>/tmp/next-prod.log &
    # Wait for server to start
    for i in $(seq 1 15); do
      sleep 1
      NC=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null)
      if [ "$NC" = "200" ]; then break; fi
    done
  fi
  sleep 10
done
