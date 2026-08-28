#!/usr/bin/env bash
#
# generate-changelog.sh — Generate markdown changelog from conventional commits.
#
# Usage:
#   bash scripts/generate-changelog.sh [version] [--notes-file FILE]
#
# Arguments:
#   version            Semantic version (e.g. 1.1.0). Used in the heading.
#   --notes-file FILE  Also write compact release notes to FILE (for gh release).
#
# Output:
#   Prints markdown changelog to stdout.
#

set -euo pipefail

VERSION="${1:-}"
NOTES_FILE=""

shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes-file)
      NOTES_FILE="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  echo "Usage: bash scripts/generate-changelog.sh <version> [--notes-file FILE]" >&2
  exit 1
fi

TODAY=$(date +%Y-%m-%d)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

EMPTY=""
COMMITS=""
if [[ -n "$LAST_TAG" && "$LAST_TAG" == "v$VERSION" ]]; then
  EMPTY=1
else
  RANGE="${LAST_TAG:+$LAST_TAG..}HEAD"
  COMMITS=$(git log "$RANGE" --pretty=format:"%s" --no-merges 2>/dev/null || echo "")
  if [[ -z "$COMMITS" ]]; then
    EMPTY=1
  fi
fi

# ── Category definitions ──────────────────────────────────────────────
# We store them as a newline-separated list of "key|label" pairs
CATEGORIES="feat|🚀 Features
fix|🐛 Bug Fixes
perf|⚡ Performance
refactor|♻️  Refactors
test|🧪 Tests
docs|📝 Documentation
build|📦 Build
ci|🔧 CI/CD
chore|🧹 Chores
style|💄 Style"

# ── Initialize output files ──────────────────────────────────────────
TMPDIR_CHANGES=$(mktemp -d)
trap 'rm -rf "$TMPDIR_CHANGES"' EXIT

while IFS='|' read -r key label; do
  echo "$label" > "$TMPDIR_CHANGES/$key.label"
  touch "$TMPDIR_CHANGES/$key.items"
done <<< "$CATEGORIES"

# ── Parse commits ────────────────────────────────────────────────────
if [[ -z "$EMPTY" ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Extract type: everything before the first colon or opening paren
    TYPE=$(echo "$line" | grep -oE '^[a-z]+' || true)
    [[ -z "$TYPE" ]] && continue

    # Check if this type has a category file
    if [[ ! -f "$TMPDIR_CHANGES/$TYPE.label" ]]; then
      continue
    fi

    # Extract scope and subject using sed
    # Remove the type prefix
    REST=$(echo "$line" | sed "s/^${TYPE}//")

    SCOPE=""
    SUBJECT=""

    # Try to match (scope): subject
    if echo "$REST" | grep -qE '^\(.+\):'; then
      SCOPE=$(echo "$REST" | sed -n 's/^(\([^)]*\)): .*/\1/p')
      SUBJECT=$(echo "$REST" | sed -n 's/^([^)]*): //p')
    # Try to match : subject
    elif echo "$REST" | grep -qE '^: .+'; then
      SUBJECT=$(echo "$REST" | sed -n 's/^: //p')
    else
      continue
    fi

    [[ -z "$SUBJECT" ]] && continue

    if [[ -n "$SCOPE" ]]; then
      ITEM="- **${SCOPE}:** ${SUBJECT}"
    else
      ITEM="- ${SUBJECT}"
    fi

    echo "$ITEM" >> "$TMPDIR_CHANGES/$TYPE.items"
  done <<< "$COMMITS"
fi

# ── Build changelog markdown ──────────────────────────────────────────
{
  echo "## $VERSION ($TODAY)"
  echo ""

  if [[ "$EMPTY" == "1" ]]; then
    echo "_No notable changes._"
    echo ""
  else
    while IFS='|' read -r key label; do
      ITEMS_FILE="$TMPDIR_CHANGES/$key.items"
      if [[ -s "$ITEMS_FILE" ]]; then
        echo "### $label"
        echo ""
        cat "$ITEMS_FILE"
        echo ""
      fi
    done <<< "$CATEGORIES"
  fi
}

# ── Write compact release notes file if requested ─────────────────────
if [[ -n "$NOTES_FILE" ]]; then
  {
    echo "## Printifya v${VERSION}"
    echo ""
    if [[ "$EMPTY" == "1" ]]; then
      echo "_No notable changes._"
    else
      while IFS='|' read -r key label; do
        ITEMS_FILE="$TMPDIR_CHANGES/$key.items"
        if [[ -s "$ITEMS_FILE" ]]; then
          echo "### $label"
          cat "$ITEMS_FILE"
          echo ""
        fi
      done <<< "$CATEGORIES"
    fi
    echo "---"
    echo "📱 **Download**: Printifya.apk (signed release)"
    echo "🔧 **Requires**: Android 7.0+"
  } > "$NOTES_FILE"
  echo "   Wrote release notes to $NOTES_FILE" >&2
fi
