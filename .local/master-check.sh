#!/usr/bin/env bash
# Usage: .local/master-check.sh <ollama-model> [runs]
# Asks a fresh Master session to start two sessions and counts real session_new calls.
D=/Users/s.marathe/projects/opencode-project
MODEL=${1:-lfm2.5:latest}
RUNS=${2:-3}
PROMPT='Plan a small python word counter in one session and implement it in another session, both at the same time.'
for n in $(seq 1 "$RUNS"); do
  S=$(curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' \
    -d '{"title":"Master check","agent":"master"}' http://127.0.0.1:4096/session | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
  curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' --max-time 600 \
    -d "{\"agent\":\"master\",\"model\":{\"providerID\":\"ollama\",\"modelID\":\"$MODEL\"},\"parts\":[{\"type\":\"text\",\"text\":\"$PROMPT\"}]}" \
    "http://127.0.0.1:4096/session/$S/message" >/dev/null
  COUNT=$(curl -sS -H "x-opencode-directory: $D" "http://127.0.0.1:4096/session/$S/children" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)))')
  echo "$MODEL run $n: master $S created $COUNT sessions"
done
