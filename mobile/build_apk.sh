#!/bin/bash
# ============================================================
# Alfanumrik Android Build Script
# Run this on your local machine with Android Studio installed
# ============================================================

set -e

echo "🏗️  Alfanumrik Android Build"
echo "================================"

# Check Flutter
if ! command -v flutter &> /dev/null; then
    echo "❌ Flutter not found. Install from https://flutter.dev"
    exit 1
fi

echo "✅ Flutter: $(flutter --version | head -1)"

# Navigate to mobile directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Get dependencies
echo ""
echo "📦 Getting dependencies..."
flutter pub get

# Run analysis
echo ""
echo "🔍 Running analysis..."
flutter analyze --no-fatal-infos
echo "✅ Analysis passed"

# Build debug APK
echo ""
echo "🔧 Building debug APK..."
flutter build apk --debug
echo "✅ Debug APK built"

# Build release APKs (split by ABI)
# All secrets MUST come from the environment — no hardcoded production URLs
# or keys. Export these before running the script:
#
#   export SUPABASE_URL="https://<project>.supabase.co"
#   export SUPABASE_ANON_KEY="<anon-key>"
#   export RAZORPAY_KEY_ID="<rzp-key-id>"
#
# If SUPABASE_URL is unset the build fails fast rather than silently pointing
# at the wrong environment.
if [ -z "${SUPABASE_URL:-}" ]; then
    echo "❌ SUPABASE_URL env var is required. Export it before running this script."
    echo "   Example: export SUPABASE_URL=https://your-project.supabase.co"
    exit 1
fi
if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
    echo "❌ SUPABASE_ANON_KEY env var is required."
    exit 1
fi

echo ""
echo "🚀 Building release APKs (split by ABI)..."
# FOXY_ENDPOINT controls which Foxy backend the mobile app calls:
#   'edge' (default) → legacy supabase/functions/v1/foxy-tutor (DEPRECATED, FTS-only)
#   'api'            → new Next.js /api/foxy (RAG + Sonnet + P12-grade safety rails)
# Default stays 'edge' so existing user builds remain unchanged. Ops will flip
# this to 'api' in a future release after staging validates the new path.
# See mobile/docs/foxy-migration.md.
flutter build apk --release --split-per-abi \
    --dart-define=SUPABASE_URL="${SUPABASE_URL}" \
    --dart-define=SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY}" \
    --dart-define=RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}" \
    --dart-define=API_BASE_URL="${API_BASE_URL:-https://alfanumrik.com/api}" \
    --dart-define=FOXY_ENDPOINT="${FOXY_ENDPOINT:-edge}"

echo ""
echo "================================"
echo "✅ BUILD COMPLETE"
echo ""
echo "📱 APK files:"
echo "   Debug:   build/app/outputs/flutter-apk/app-debug.apk"
echo "   arm64:   build/app/outputs/flutter-apk/app-arm64-v8a-release.apk"
echo "   arm32:   build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk"
echo "   x86_64:  build/app/outputs/flutter-apk/app-x86_64-release.apk"
echo ""
echo "💡 For most Indian devices, use the arm64 APK."
echo "   For older budget phones, use the arm32 APK."
echo ""
echo "⚠️  Before Play Store release:"
echo "   1. Replace signingConfig with your release keystore"
echo "   2. Set real SUPABASE_ANON_KEY and RAZORPAY_KEY_ID"
echo "   3. Run: flutter build appbundle --release"
