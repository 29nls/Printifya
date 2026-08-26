import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.printifya.app",
  appName: "Printifya",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    App: {
      // Auto-update settings
      launchShowDuration: 2000,
    },
    Camera: {
      permissions: ["camera", "photos"],
    },
    Filesystem: {
      permissions: ["read", "write"],
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#3F51B5",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    // Auto-update: Interval pengecekan (6 jam = 21600000 ms)
    // Endpoint harus mengembalikan JSON: { version, versionCode, notes, apkUrl }
    // Contoh: https://raw.githubusercontent.com/user/repo/main/update.json
  },
};

export default config;
