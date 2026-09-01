package com.printifya.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

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
            File file = new File(path);
            if (!file.exists()) {
                call.reject("APK file not found: " + path);
                return;
            }

            Uri fileUri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                // Android 7+: use FileProvider for content:// URI
                fileUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
                );
            } else {
                // Android 6 and below: use file:// URI
                fileUri = Uri.fromFile(file);
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
}
