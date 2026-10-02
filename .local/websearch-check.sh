#!/usr/bin/env bash
# Usage: .local/websearch-check.sh <ollama-model>
# Asks a fresh build session to search the web and prints each tool call's name, status and error.
D=/Users/s.marathe/projects/opencode-project
MODEL=${1:-lfm2.5:latest}
S=$(curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' \
  -d '{"agent":"build"}' http://127.0.0.1:4096/session | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')
curl -sS -X POST -H "x-opencode-directory: $D" -H 'content-type: application/json' --max-time 600 \
  -d "{\"agent\":\"build\",\"model\":{\"providerID\":\"ollama\",\"modelID\":\"$MODEL\"},\"parts\":[{\"type\":\"text\",\"text\":\"Search the internet for the latest released version of the Bun JavaScript runtime and tell me the number.\"}]}" \
  "http://127.0.0.1:4096/session/$S/message" >/dev/null
curl -sS -H "x-opencode-directory: $D" "http://127.0.0.1:4096/session/$S/message" | python3 -c '
import json,sys
for m in json.load(sys.stdin):
  for p in m["parts"]:
    if p["type"]=="tool": print("tool", p["tool"], p["state"]["status"], str(p["state"].get("error",""))[:160])
    if p["type"]=="text" and m["info"]["role"]=="assistant": print("reply:", p["text"][:300])'
echo "$MODEL session $S"
