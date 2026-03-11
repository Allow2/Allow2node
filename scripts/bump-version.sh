#!/usr/bin/env bash
# bump-version.sh — Standardised version bumping for Allow2 Node SDK
# Usage: ./scripts/bump-version.sh [prerelease|patch|minor|major] [--preid alpha|beta|rc]
#
# Examples:
#   ./scripts/bump-version.sh prerelease --preid alpha   # 2.0.0-alpha.6 → 2.0.0-alpha.7
#   ./scripts/bump-version.sh prerelease --preid beta    # 2.0.0-alpha.7 → 2.0.0-beta.0
#   ./scripts/bump-version.sh patch                       # 2.0.0-alpha.7 → 2.0.1
#   ./scripts/bump-version.sh minor                       # 2.0.1 → 2.1.0
#   ./scripts/bump-version.sh major                       # 2.1.0 → 3.0.0
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-prerelease}"
PREID=""
if [[ "${2:-}" == "--preid" ]]; then PREID="${3:-alpha}"; fi

OLD=$(node -p "require('./package.json').version")

case "$BUMP" in
  prerelease)
    if [[ -n "$PREID" ]]; then
      npm version prerelease --preid="$PREID" --no-git-tag-version
    else
      npm version prerelease --no-git-tag-version
    fi
    ;;
  patch|minor|major)
    npm version "$BUMP" --no-git-tag-version
    ;;
  *)
    echo "Usage: $0 [prerelease|patch|minor|major] [--preid alpha|beta|rc]" >&2
    exit 1
    ;;
esac

NEW=$(node -p "require('./package.json').version")
echo "$OLD → $NEW"

git add package.json
git commit -m "v$NEW"
git tag "v$NEW"
echo "Tagged v$NEW — push with: git push origin main --tags"
