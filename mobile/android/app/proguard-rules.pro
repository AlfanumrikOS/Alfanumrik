# Flutter
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Razorpay — payment gateway
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-dontwarn com.razorpay.**
-keep class com.razorpay.** { *; }

# Supabase / OkHttp / Retrofit
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep class okio.** { *; }

# Hive local storage
-keep class * extends com.google.crypto.tink.shaded.protobuf.GeneratedMessageLite { *; }

# Gson
-keepattributes Signature
-keep class com.google.gson.** { *; }

# Keep source file names for crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
