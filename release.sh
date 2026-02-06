#!/bin/bash
set -euo pipefail

# Usage: ./release.sh <version_type> [release_notes_file]

if [ "$#" -lt 1 ]; then
  echo "Usage: ./release.sh <version_type> [release_notes_file]"
  echo "  version_type: patch, minor, or major"
  echo "  release_notes_file: (Optional) path to release notes markdown"
  exit 1
fi

VERSION_TYPE="$1"
RELEASE_NOTES_FILE="${2:-}"

if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Error: version_type must be patch, minor, or major"
  exit 1
fi

if [[ -n "$RELEASE_NOTES_FILE" && ! -f "$RELEASE_NOTES_FILE" ]]; then
  echo "Error: release notes file not found: $RELEASE_NOTES_FILE"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required. Install from https://cli.github.com/"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working directory is not clean. Commit or stash changes first."
  exit 1
fi

echo "📥 Pulling latest changes from origin/main..."
git pull origin main

echo "🧱 Building production assets..."
npm run build

if [[ ! -f main.js || ! -f manifest.json || ! -f styles.css ]]; then
  echo "Error: build artifacts missing. Ensure main.js, manifest.json, and styles.css exist."
  exit 1
fi

echo "📈 Bumping $VERSION_TYPE version..."
NEW_VERSION=$(npm version "$VERSION_TYPE")
GIT_TAG=$(git describe --tags --abbrev=0)

echo "📤 Pushing commits and tags..."
git push origin main
git push origin --tags

RELEASE_NOTES="## What's Changed\n\nSee commit history for details."
if [[ -n "$RELEASE_NOTES_FILE" ]]; then
  RELEASE_NOTES=$(cat "$RELEASE_NOTES_FILE")
fi

echo "📦 Creating GitHub release $GIT_TAG..."
gh release create "$GIT_TAG" \
  --title "Version $GIT_TAG" \
  --notes "$RELEASE_NOTES" \
  ./main.js ./manifest.json ./styles.css

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "✅ Release created: https://github.com/$REPO/releases/tag/$GIT_TAG"
