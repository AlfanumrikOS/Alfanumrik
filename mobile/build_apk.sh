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
echo ""
echo "🚀 Building release APKs (split by ABI)..."
flutter build apk --release --split-per-abi \
    --dart-define=SUPABASE_URL=https://shktyoxqhundlvkiwguu.supabase.co \
    --dart-define=SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-PUT_YOUR_KEY_HERE}" \
    --dart-define=RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-PUT_YOUR_KEY_HERE}" \
    --dart-define=API_BASE_URL=https://alfanumrik.com/api

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
