#!/bin/bash
cd $(dirname "$0")
export NODE_ENV=production
export HOSTNAME=0.0.0.0
export PORT=3020

# Ensure static and public are copied
mkdir -p .next/standalone/.next/static
cp -rn .next/static .next/standalone/.next/ 2>/dev/null
cp -rn public .next/standalone/ 2>/dev/null

exec node .next/standalone/server.js >> /tmp/diphunter-server.log 2>&1
