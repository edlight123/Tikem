#!/usr/bin/env bash
# Publish a production OTA to every live app version that can run it.
#
#   scripts/publish-ota.sh "message"            HEAD of main
#   scripts/publish-ota.sh "message" <commit>   a specific commit
#
# Why several runtimes: runtimeVersion follows appVersion, so an update
# published from version 1.0.2 never reaches phones still on 1.0.1 or 1.0.0
# (older App Store builds, TestFlight installs). Until they have all updated, we
# publish the same JS once per live version: as-is, then with app.json's
# version set to each of LEGACY_RUNTIMES.
#
# Android: build 5 (1.0.2) is the first Android build on the current native
# side, so it gets the current-runtime publish. The only older Android build,
# versionCode 4 (runtime 1.0.0, commit 87609bb0), predates build 46's native
# changes (no expo-asset), so legacy publishes are iOS-only.
#
# The legacy publishes are only safe while the NATIVE side is identical to
# build 46 (builds 50 and later changed no native code): same package.json /
# package-lock.json. The script refuses them if they drifted (a new native
# module would crash those phones).
#
# Always from a clean detached worktree at the commit (never a working tree
# with uncommitted agent work), and only after checking that the EAS production
# env carries every EXPO_PUBLIC_* in mobile/.env (memory: eas-update-env-gotcha).
set -euo pipefail

MSG="${1:?usage: scripts/publish-ota.sh \"message\" [commit]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMMIT="$(git -C "$ROOT" rev-parse "${2:-HEAD}")"
WT="$ROOT/.claude/worktrees/ota-bb449303"
BUILD_46_COMMIT=6476fd20   # last native change; runtimes 1.0.0 and 1.0.1 both carry it
LEGACY_RUNTIMES="1.0.1 1.0.0"

if [ ! -d "$WT" ]; then
  git -C "$ROOT" worktree add --detach "$WT" "$COMMIT" >/dev/null
  cp "$ROOT/mobile/.env" "$WT/mobile/.env"
  (cd "$WT/mobile" && npm ci --no-audit --no-fund)
fi
git -C "$WT" checkout -q --detach "$COMMIT"
git -C "$WT" checkout -q -- mobile/app.json   # undo any leftover 1.0.0 edit

# Reinstall only when the lockfile differs from the one node_modules was built from.
LOCK_SHA=$(shasum "$WT/mobile/package-lock.json" | cut -d' ' -f1)
STAMP="$WT/mobile/node_modules/.tikem-lock-sha"
if [ "$(cat "$STAMP" 2>/dev/null)" != "$LOCK_SHA" ]; then
  echo "package-lock changed since the last install: running npm ci"
  (cd "$WT/mobile" && npm ci --no-audit --no-fund)
  echo "$LOCK_SHA" > "$STAMP"
fi

cd "$WT/mobile"
missing=$(comm -23 <(grep -oE '^EXPO_PUBLIC_[A-Z0-9_]+' "$ROOT/mobile/.env" | sort -u) \
  <(npx -y eas-cli@latest env:list --environment production 2>/dev/null | grep -oE 'EXPO_PUBLIC_[A-Z0-9_]+' | sort -u))
if [ -n "$missing" ]; then
  echo "EAS production env is missing: $missing" >&2
  exit 1
fi

npx tsc --noEmit

publish() {
  npx eas-cli@latest update --channel production --environment production --non-interactive \
    --platform "$2" -m "$1" \
    | grep -E "Published|Runtime|Update group ID|rror"
}

current=$(node -p "require('./app.json').expo.version")
echo "== runtime $current (ios + android)"
publish "$MSG" all

native_same=1
git -C "$ROOT" diff --quiet "$BUILD_46_COMMIT" "$COMMIT" -- mobile/package.json mobile/package-lock.json || native_same=0

for legacy in $LEGACY_RUNTIMES; do
  [ "$legacy" = "$current" ] && continue
  if [ "$native_same" = 1 ]; then
    echo "== runtime $legacy, iOS only (native side unchanged since build 46)"
    node -e "const f='app.json',j=require('./'+f);j.expo.version='$legacy';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
    publish "$MSG" ios
    git -C "$WT" checkout -q -- mobile/app.json
  else
    echo "== SKIPPED runtime $legacy: native dependencies changed since build 46; those phones need the store update"
  fi
done
