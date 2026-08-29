#!/bin/sh
# Fails if a tracked *.env.example holds a value for a *sensitive* key.
# Non-secret defaults (PORT, localhost URLs, a mailto: placeholder) are fine —
# the point is that keys, secrets, tokens, passwords and connection strings
# must be blank in the templates.
#
# Run:  sh scripts/check-env-examples.sh

set -e

FILES="backend/.env.example client/.env.example"
# Key-name substrings that must never carry a value in a template.
SENSITIVE='(_KEY|_SECRET|_TOKEN|_PASSWORD|PRIVATE|SERVICE_ROLE|DATABASE_URL)'
status=0

for f in $FILES; do
  [ -f "$f" ] || continue
  # lines like  NAME=value  where NAME matches SENSITIVE and value is non-empty.
  # Strip CR first so a CRLF checkout doesn't read "\r" as a value.
  hits=$(tr -d '\r' < "$f" | grep -nE "^[A-Za-z_][A-Za-z0-9_]*${SENSITIVE}[A-Za-z0-9_]*=.+" || true)
  if [ -n "$hits" ]; then
    echo "ERROR: $f has a value for a sensitive key (must be blank in templates):"
    echo "$hits" | sed 's/^/  /'
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "env examples OK — no sensitive values."
fi
exit "$status"
