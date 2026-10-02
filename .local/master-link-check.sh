#!/usr/bin/env bash
# Usage: .local/master-link-check.sh <master-model>
# Asks a fresh Master session to start two sessions on a chosen model with instructions,
# then prints the session_new inputs/outputs, the children, and the Master's reply (should contain /session/ links).
D=/Users/s.marathe/projects/opencode-project
MODEL=${1:-ornith-heretic:latest}
PROMPT='Start two sessions at the same time using model ollama/lfm2.5:latest: one plan session titled Plan: haiku tool that plans a tiny python haiku generator, and one build session titled Build: haiku tool that writes haiku.py. Give both the instructions: answer briefly.'
S=$(curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' \
  -d '{"agent":"master"}' http://127.0.0.1:4096/session | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' --max-time 600 \
  -d "{\"agent\":\"master\",\"model\":{\"providerID\":\"ollama\",\"modelID\":\"$MODEL\"},\"parts\":[{\"type\":\"text\",\"text\":\"$PROMPT\"}]}" \
  "http://127.0.0.1:4096/session/$S/message" >/dev/null
curl -sS -H "x-opencode-directory: $D" "http://127.0.0.1:4096/session/$S/message" | python3 -c '
import json,sys
for m in json.load(sys.stdin):
  for p in m["parts"]:
    if p["type"]=="tool": print("tool", p["tool"], p["state"]["status"], json.dumps(p["state"].get("input"))[:200], "->", str(p["state"].get("output") or p["state"].get("error",""))[:200])
    if p["type"]=="text" and m["info"]["role"]=="assistant": print("reply:", p["text"][-500:])'
curl -sS -H "x-opencode-directory: $D" "http://127.0.0.1:4096/session/$S/children" | python3 -c 'import json,sys;[print("child", s["id"], s["title"], s["directory"]) for s in json.load(sys.stdin)]'
echo "master $S"
