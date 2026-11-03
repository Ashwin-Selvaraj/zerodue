#!/usr/bin/env bash
# Generates the Android platform folder (needs Flutter on PATH) and applies ZeroDue branding.
# Run once from apps/mobile:  bash tool/bootstrap_android.sh
set -euo pipefail
cd "$(dirname "$0")/.."

flutter create --org com.ashwin --project-name zerodue --platforms android .

MANIFEST=android/app/src/main/AndroidManifest.xml
# Set the launcher label to "ZeroDue" (BSD/GNU sed compatible).
sed -i.bak -E 's/android:label="[^"]*"/android:label="ZeroDue"/' "$MANIFEST" && rm -f "$MANIFEST.bak"

grep -q 'applicationId = "com.ashwin.zerodue"' android/app/build.gradle* \
  || echo "WARN: check applicationId in android/app/build.gradle(.kts) is com.ashwin.zerodue"
echo "Done. Label=ZeroDue, package=com.ashwin.zerodue"
