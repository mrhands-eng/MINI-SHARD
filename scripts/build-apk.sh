#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-debug}"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "ANDROID_HOME not found at $ANDROID_HOME" >&2
  exit 1
fi

echo "==> vite build + cap sync"
npm run build
npx cap sync android

# Ensure local.properties points at SDK
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

cd android

if [[ "$MODE" == "release" ]]; then
  if [[ -f ../keystore.properties ]]; then
    echo "==> assembleRelease (custom keystore)"
    ./gradlew assembleRelease
    APK="app/build/outputs/apk/release/app-release.apk"
  else
    echo "==> no keystore.properties — building unsigned-compatible debug APK for sideload"
    ./gradlew assembleDebug
    APK="app/build/outputs/apk/debug/app-debug.apk"
  fi
else
  echo "==> assembleDebug"
  ./gradlew assembleDebug
  APK="app/build/outputs/apk/debug/app-debug.apk"
fi

OUT_DIR="$ROOT/release"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT_DIR/mini-shard-${MODE}-${STAMP}.apk"
cp "$APK" "$DEST"
# stable latest copy
cp "$APK" "$OUT_DIR/mini-shard-latest.apk"

echo ""
echo "APK ready:"
echo "  $DEST"
echo "  $OUT_DIR/mini-shard-latest.apk"
ls -lh "$DEST"
