import { registerPlugin } from "@capacitor/core";

export interface InstallApkResult {
  success: boolean;
  path: string;
}

export interface ApkInstallerPlugin {
  installApk(options: { path: string }): Promise<InstallApkResult>;
}

const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");

export { ApkInstaller };
