#!/bin/bash
input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file_path" ] && exit 0

case "$file_path" in
  */src/graph/*|*/src/agents/*|*/src/collectors/*|*/src/db/*|*package.json|*docker-compose.yml|*.env.example)
    cat <<'JSONEOF'
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "This change touched a structurally significant file. If this represents a real architectural or design decision (not a routine fix/typo), append an entry to ~/dev/obsidian-vault/Projects/signal/decisions.md with today's date, what changed, why, and alternatives considered if relevant. Skip this for trivial changes — use judgment, don't log everything."}}
JSONEOF
    ;;
  *)
    exit 0
    ;;
esac
exit 0
