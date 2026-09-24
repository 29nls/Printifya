package com.printifya.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("Missing 'path' parameter");
            return;
        }

        try {
            if (!canRequestPackageInstalls()) {
                call.reject("INSTALL_PERMISSION_DENIED: izin 'Install aplikasi tidak dikenal' belum aktif untuk aplikasi ini");
                return;
            }

            Uri fileUri;

            if (path.startsWith("content://")) {
                // Already a content:// URI — use directly
                fileUri = Uri.parse(path);
            } else if (path.startsWith("file://")) {
                // file:// URI — extract path and use FileProvider
                String filePath = Uri.parse(path).getPath();
                if (filePath == null) {
                    call.reject("Invalid file URI: " + path);
                    return;
                }
                fileUri = createFileUri(new File(filePath));
            } else {
                // Raw file path — resolve against cache directory
                File file = resolveFile(path);
                if (!file.exists()) {
                    call.reject("APK file not found: " + path + " (resolved: " + file.getAbsolutePath() + ")");
                    return;
                }
                fileUri = createFileUri(file);
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(fileUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("path", path);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to open APK installer: " + e.getMessage(), e);
        }
    }

    /**
     * Apakah aplikasi boleh memasang APK? Android 8+ mewajibkan izin per-aplikasi
     * "Install unknown apps"; sebelum Android 8 tidak ada batasan.
     */
    private boolean canRequestPackageInstalls() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    /**
     * Dipanggil JS sebelum mengunduh: tahu lebih awal apakah izin pemasangan
     * sudah ada, sehingga unduhan tidak sia-sia.
     */
    @PluginMethod
    public void canInstallPackages(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", canRequestPackageInstalls());
        call.resolve(result);
    }

    /**
     * Buka layar pengaturan izin pemasangan untuk aplikasi ini, agar pengguna
     * tidak perlu mencari sendiri di Pengaturan Android.
     */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
                );
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to open install settings: " + e.getMessage(), e);
        }
    }

    /**
     * Create a URI for the given file, using FileProvider on Android 7+.
     */
    private Uri createFileUri(File file) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            return FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
            );
        } else {
            return Uri.fromFile(file);
        }
    }

    /**
     * Resolve a relative path against the app's cache directory.
     * Handles paths like "updates/printifya-1.2.2.apk".
     */
    private File resolveFile(String path) {
        // If it's an absolute path, use it directly
        if (path.startsWith("/")) {
            return new File(path);
        }
        // Otherwise resolve against cache directory
        return new File(getContext().getCacheDir(), path);
    }
}
