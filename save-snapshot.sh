#!/bin/bash
# ─── Dip Hunter — Quick Save Snapshot ─────────────────────────────────────────
# Creates a git commit with all current changes as a safety snapshot.
# Run: bash $(dirname "$0")/save-snapshot.sh "optional message"

cd $(dirname "$0")

MSG="${1:-snapshot: $(date '+%Y-%m-%d %H:%M:%S')}"

echo "💾 Saving snapshot: $MSG"
git add -A
CHANGES=$(git diff --cached --stat | tail -1)
if [ -z "$CHANGES" ]; then
  echo "✅ No changes to commit — everything already saved."
else
  git commit -m "$MSG"
  echo "✅ Snapshot saved: $CHANGES"
fi
