#!/bin/bash
# Dip Hunter - Quick start after reboot
# Run this script if the server doesn't auto-start after PC restart
cd $(dirname "$0")

echo "=== Dip Hunter Start Script ==="
echo "[$(date)] Checking server status..."

# Check if already running
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null | grep -q "200"; then
  echo "[$(date)] Server is already running on port 3020!"
  exit 0
fi

echo "[$(date)] Server not running. Starting via PM2..."

# Try PM2 first
if command -v pm2 &>/dev/null; then
  # Try resurrect from saved state
  pm2 resurrect 2>/dev/null
  
  # If that didn't work, use ecosystem config
  sleep 2
  if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:3020 2>/dev/null | grep -q "200"; then
    pm2 start ecosystem.config.js
    pm2 save
  fi
else
  # Fallback: start directly
  cd $(dirname "$0")/.next/standalone
  NODE_ENV=production PORT=3020 HOSTNAME=0.0.0.0 node server.js &
fi

# Wait for server to be ready
echo "[$(date)] Waiting for server..."
for i in $(seq 1 30); do
  if curl -s -o /dev/null http://localhost:3020 2>/dev/null; then
    echo "[$(date)] Server ready on :3020!"
    exit 0
  fi
  sleep 1
done

echo "[$(date)] WARNING: Server did not respond within 30s"
exit 1
