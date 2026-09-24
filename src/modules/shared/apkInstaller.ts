import { registerPlugin } from "@capacitor/core";

export interface InstallApkResult {
  success: boolean;
  path: string;
}

export interface InstallPermissionResult {
  /** true bila Android mengizinkan aplikasi ini memasang APK. */
  granted: boolean;
}

export interface ApkInstallerPlugin {
  /** Buka installer Android untuk APK yang sudah diunduh. */
  installApk(options: { path: string }): Promise<InstallApkResult>;
  /**
   * Cek izin "Install aplikasi tidak dikenal" (Android 8+).
   * Opsional: APK lama belum punya method ini.
   */
  canInstallPackages?(): Promise<InstallPermissionResult>;
  /** Buka layar pengaturan izin pemasangan untuk aplikasi ini. */
  openInstallSettings?(): Promise<{ success: boolean }>;
}

const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

export { ApkInstaller };
