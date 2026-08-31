#!/bin/bash
cd $(dirname "$0")
while true; do
  pkill -f "next start" 2>/dev/null
  sleep 1
  npx next start -p 3020 -H 0.0.0.0 &
  NEXT_PID=$!
  echo "Started Next.js PID=$NEXT_PID at $(date)" > /tmp/next-status.txt
  # Wait for it to be ready
  for i in $(seq 1 15); do
    if curl -s -o /dev/null http://localhost:3020 2>/dev/null; then break; fi
    sleep 1
  done
  echo "Ready at $(date)" >> /tmp/next-status.txt
  # Now wait for the process to die
  while kill -0 $NEXT_PID 2>/dev/null; do sleep 2; done
  echo "Died at $(date), restarting..." >> /tmp/next-status.txt
  sleep 2
done
