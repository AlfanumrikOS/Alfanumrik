# ===========================================================================
# Alfanumrik Android — R8 / ProGuard keep rules for the minified release build.
#
# CAVEAT: This file is hand-authored to be CONSERVATIVE (keep too much rather
# than too little). The ONLY way to fully verify that a minified release does
# not strip a needed class is an actual `flutter build appbundle --release`
# run — which requires the upload keystore + CI secrets and is NOT runnable in
# this environment (Gradle daemon is loopback-blocked here, and the keystore is
# supplied by the user via CI). If a release crash ever traces to a missing /
# obfuscated class, add a `-keep` for that class+package here rather than
# disabling minification.
# ===========================================================================

# ---------------------------------------------------------------------------
# Flutter engine + embedding
# ---------------------------------------------------------------------------
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.embedding.**

# ---------------------------------------------------------------------------
# Kotlin (coroutines + metadata used reflectively by several plugins)
# ---------------------------------------------------------------------------
-keep class kotlin.** { *; }
-keep class kotlin.Metadata { *; }
-keepclassmembers class **$WhenMappings { *; }
-keepclassmembers class kotlin.Metadata { public <methods>; }
-dontwarn kotlin.**
-keepclassmembernames class kotlinx.** { volatile <fields>; }
-keep class kotlinx.coroutines.** { *; }
-dontwarn kotlinx.coroutines.**

# ---------------------------------------------------------------------------
# Razorpay (razorpay_flutter) — heavy reflection + JS bridge.
# The Razorpay SDK is notorious for breaking under minification; keep the whole
# SDK + the proguard.annotation classes it references, and silence its warnings.
# ---------------------------------------------------------------------------
-keep class com.razorpay.** { *; }
-keep class proguard.annotation.** { *; }
-keep class proguard.annotation.Keep
-keep class proguard.annotation.KeepClassMembers
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn com.razorpay.**
-dontwarn proguard.annotation.**
# Razorpay pulls in Google Pay / analytics helpers that may be absent at runtime.
-optimizations !method/inlining/*
-keepclasseswithmembers class * {
    public void onPayment*(...);
}

# ---------------------------------------------------------------------------
# Supabase / gotrue / realtime — OkHttp + Retrofit + Gson reflection.
# Keep HTTP stack + model classes so JSON (de)serialization survives shrinking.
# ---------------------------------------------------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }
-keep class okio.** { *; }

-dontwarn retrofit2.**
-keep class retrofit2.** { *; }
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

-keep class io.supabase.** { *; }
-keep class io.github.jan.supabase.** { *; }
-dontwarn io.supabase.**
-dontwarn io.github.jan.supabase.**

# ---------------------------------------------------------------------------
# Gson / json (de)serialization (Supabase + several plugins use reflection).
# Keep model fields with @SerializedName and generic type info.
# ---------------------------------------------------------------------------
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.google.gson.** { *; }
-keep class com.google.gson.reflect.TypeToken { *; }
-keep class * extends com.google.gson.reflect.TypeToken
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-dontwarn sun.misc.**

# ---------------------------------------------------------------------------
# dio (HTTP) — Dart-side package; native side rides on OkHttp/conscrypt.
# No reflection of its own, but keep TLS provider it may probe.
# ---------------------------------------------------------------------------
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ---------------------------------------------------------------------------
# Hive (hive_flutter) — adapters generated reflectively; keep Tink protobuf
# shaded classes Hive's encrypted box relies on.
# ---------------------------------------------------------------------------
-keep class * extends com.google.crypto.tink.shaded.protobuf.GeneratedMessageLite { *; }
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**

# ---------------------------------------------------------------------------
# Sentry (sentry_flutter) — uses reflection for native crash + breadcrumb hooks.
# ---------------------------------------------------------------------------
-keep class io.sentry.** { *; }
-keep interface io.sentry.** { *; }
-dontwarn io.sentry.**

# ---------------------------------------------------------------------------
# WebView (webview_flutter) — STEM Lab embeds /stem-centre. Keep the JS bridge.
# ---------------------------------------------------------------------------
-keep class io.flutter.plugins.webviewflutter.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-dontwarn android.webkit.**

# ---------------------------------------------------------------------------
# AndroidX / multidex / annotations
# ---------------------------------------------------------------------------
-keep class androidx.multidex.** { *; }
-dontwarn androidx.**
-keep class * extends androidx.annotation.Keep
-keep @androidx.annotation.Keep class * { *; }
-keepclasseswithmembers class * {
    @androidx.annotation.Keep <methods>;
}
-keepclasseswithmembers class * {
    @androidx.annotation.Keep <fields>;
}

# ---------------------------------------------------------------------------
# Generic safety nets
# ---------------------------------------------------------------------------
# Keep native methods (JNI) — names must not be obfuscated.
-keepclasseswithmembernames class * {
    native <methods>;
}
# Keep enums' values()/valueOf() (used reflectively).
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
# Keep Parcelable CREATOR fields.
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}
# Keep Serializable plumbing.
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# Keep readable stack traces for Sentry symbolication.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
