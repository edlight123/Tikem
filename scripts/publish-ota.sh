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
# Android: build 5 (1.0.2) runs build 46's native side, so runtime 1.0.2 is
# published for both platforms. The only older Android build, versionCode 4
# (runtime 1.0.0, commit 87609bb0), predates build 46's native changes (no
# expo-asset), so the 1.0.1 / 1.0.0 publishes are iOS-only.
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
BUILD_46_COMMIT=6476fd20   # last native change; runtimes 1.0.0, 1.0.1 and 1.0.2 all carry it
# runtime:platforms. 1.0.2 also has an Android build (versionCode 5).
LEGACY_RUNTIMES="1.0.3:all 1.0.2:all 1.0.1:ios 1.0.0:ios"
# Native modules added after build 46 that the JS only reaches through
# requireOptionalNativeModule (absent on old binaries = feature off, no crash).
# They don't count as native drift for the legacy publishes.
OPTIONAL_NATIVE="expo-media-library expo-location"

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

# Same direct dependencies as build 46, ignoring OPTIONAL_NATIVE? (Native
# modules are direct deps, so this is the check that matters; the lockfile
# moves with any of them.)
deps_at() { git -C "$ROOT" show "$1:mobile/package.json" | node -e "
  const skip=new Set(process.argv[1].split(' ').filter(Boolean));
  const d=JSON.parse(require('fs').readFileSync(0,'utf8')).dependencies||{};
  console.log(Object.keys(d).filter(k=>!skip.has(k)).sort().map(k=>k+'@'+d[k]).join('\n'));" "$OPTIONAL_NATIVE"; }
native_same=1
[ "$(deps_at "$BUILD_46_COMMIT")" = "$(deps_at "$COMMIT")" ] || native_same=0

for entry in $LEGACY_RUNTIMES; do
  legacy="${entry%%:*}"; platforms="${entry##*:}"
  [ "$legacy" = "$current" ] && continue
  if [ "$native_same" = 1 ]; then
    echo "== runtime $legacy, $platforms (native side unchanged since build 46)"
    node -e "const f='app.json',j=require('./'+f);j.expo.version='$legacy';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
    publish "$MSG" "$platforms"
    git -C "$WT" checkout -q -- mobile/app.json
  else
    echo "== SKIPPED runtime $legacy: native dependencies changed since build 46; those phones need the store update"
  fi
done
