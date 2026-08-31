#!/bin/bash
cd /home/z/my-project
export NODE_ENV=production
export HOSTNAME=0.0.0.0
export PORT=3020

# Kill any existing server
pkill -f "node.*standalone/server.js" 2>/dev/null
sleep 1

# Start the server
exec node .next/standalone/server.js 2>&1
