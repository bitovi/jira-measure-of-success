#!/bin/sh
# Runs the Forge CLI with the repo-root .env loaded so manifest.yml can
# resolve ${APP_ID}.
#
# `register` is special-cased for forks: Forge rewrites manifest.yml with a
# literal app id, so we save that id to .env and restore the ${APP_ID}
# placeholder instead.
set -e
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$APP_DIR/../.env"
MANIFEST="$APP_DIR/manifest.yml"
PLACEHOLDER_ID=00000000-0000-0000-0000-000000000000

if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

if [ "$1" = register ]; then
  # Forge parses the manifest after creating the app, so ${APP_ID} must
  # resolve to something or the registration half-completes.
  export APP_ID="${APP_ID:-$PLACEHOLDER_ID}"
  cp "$MANIFEST" "$MANIFEST.bak"
  trap 'mv "$MANIFEST.bak" "$MANIFEST"' EXIT
  forge "$@"
  new_id=$(grep -oE 'ari:cloud:ecosystem::app/[0-9a-fA-F-]{36}' "$MANIFEST" | head -n 1 | sed 's#.*/##')
  if [ -z "$new_id" ] || [ "$new_id" = "$APP_ID" ]; then
    echo "Could not find a new app id in manifest.yml; .env left unchanged." >&2
    exit 1
  fi
  touch "$ENV_FILE"
  if grep -q '^APP_ID=' "$ENV_FILE"; then
    sed -i.bak "s/^APP_ID=.*/APP_ID=$new_id/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '\nAPP_ID=%s\n' "$new_id" >> "$ENV_FILE"
  fi
  echo "Saved APP_ID=$new_id to .env (manifest.yml keeps the \${APP_ID} placeholder)."
  exit 0
fi

if [ -z "$APP_ID" ] || [ "$APP_ID" = "$PLACEHOLDER_ID" ]; then
  echo "APP_ID is not set in .env. Register your own Forge app with: npm run forge -- register" >&2
  exit 1
fi

exec forge "$@"
