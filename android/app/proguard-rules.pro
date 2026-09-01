# ============================================================
# Printifya — ProGuard / R8 Rules for Capacitor Android App
# ============================================================

# ── Capacitor Core ──────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.android.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
}
-keepclassmembers class * {
    @com.getcapacitor.annotation.CapacitorCallback <methods>;
}

# ── Capacitor Plugins ───────────────────────────────────────
-keep class com.getcapacitor.plugins.** { *; }

# Camera
-keep class com.getcapacitor.plugins.camera.** { *; }

# Filesystem
-keep class com.getcapacitor.plugins.filesystem.** { *; }

# Share
-keep class com.getcapacitor.plugins.share.** { *; }

# App
-keep class com.getcapacitor.plugins.app.** { *; }

# Browser
-keep class com.getcapacitor.plugins.browser.** { *; }

# Device
-keep class com.getcapacitor.plugins.device.** { *; }

# Preferences
-keep class com.getcapacitor.plugins.preferences.** { *; }

# Splash Screen
-keep class com.getcapacitor.plugins.splashscreen.** { *; }

# ── Capacitor Cordova Plugins ───────────────────────────────
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── Android WebView (required for Capacitor) ────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# ── Keep source file + line numbers for crash reports ───────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Annotation processing ───────────────────────────────────
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses,EnclosingMethod

# ── Enum safety ─────────────────────────────────────────────
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ── Parcelable ──────────────────────────────────────────────
-keepclassmembers class * implements android.os.Parcelable {
    public static final ** CREATOR;
}

# ── Serializable ────────────────────────────────────────────
-keepclassmembers class * implements java.io.Serializable {
    static final long serialVersionUID;
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# ── WebView JavaScript Bridge (Capacitor uses this) ─────────
-keepclassmembers class com.getcapacitor.bridge.** {
    *;
}

# ── Don't warn about optional dependencies ──────────────────
-dontwarn javax.annotation.**
-dontwarn sun.misc.Unsafe
-dontwarn org.codehaus.mojo.animal_sniffer.**
-dontwarn kotlin.**
-dontwarn kotlinx.**

# ── R8 full mode compatibility ─────────────────────────────
-allowaccessmodification
-repackageclasses
