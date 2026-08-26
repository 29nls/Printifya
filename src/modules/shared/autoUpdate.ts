import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

// ── Types ──────────────────────────────────────────────────────────────────

export interface UpdateInfo {
  /** Version string, e.g. "1.2.3" */
  version: string;
  /** Numeric version code for Android (used for comparison) */
  versionCode: number;
  /** Changelog / release notes */
  notes?: string | string[];
  /** Direct APK download URL */
  apkUrl?: string;
  /** Release page URL (fallback if apkUrl not provided) */
  releaseUrl?: string;
  /** File size in bytes (optional, for progress display) */
  fileSize?: number;
  /** Release date */
  releaseDate?: string;
}

export interface UpdateConfig {
  /** Endpoint that returns JSON with UpdateInfo fields */
  endpoint: string;
  /** How often to check (ms). Default: 6 hours */
  checkIntervalMs?: number;
  /** Skip versions equal to or older than this */
  minVersionCode?: number;
  /** Callback when update is available */
  onUpdateAvailable?: (info: UpdateInfo) => void;
  /** Callback when check completes with no update */
  onNoUpdate?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Auto-download APK before prompting (default: true) */
  autoDownload?: boolean;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
  percent: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const STORAGE_KEY_LAST_CHECK = "printifya.update.lastCheck";
const STORAGE_KEY_SKIPPED_VERSION = "printifya.update.skipped";
const DEFAULT_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

// ── Helpers ────────────────────────────────────────────────────────────────

async function getCurrentVersion(): Promise<{ version: string; versionCode: number }> {
  try {
    const info = await App.getInfo();
    return {
      version: info.version,
      versionCode: 1,
    };
  } catch {
    return { version: "0.0.0", versionCode: 0 };
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// ── Main API ───────────────────────────────────────────────────────────────

/**
 * Check for app updates from a remote endpoint.
 *
 * Expected JSON response from `config.endpoint`:
 * ```json
 * {
 *   "version": "1.2.0",
 *   "versionCode": 120,
 *   "notes": "- Fix bug X\n- Add feature Y",
 *   "apkUrl": "https://github.com/.../app-release.apk",
 *   "releaseUrl": "https://github.com/.../releases/tag/v1.2.0",
 *   "releaseDate": "2026-08-27"
 * }
 * ```
 */
export async function checkForUpdate(config: UpdateConfig): Promise<UpdateInfo | null> {
  if (!isNative()) return null;

  try {
    const current = await getCurrentVersion();
    const res = await fetch(config.endpoint, {
      headers: { "Accept": "application/json" },
    });

    if (!res.ok) {
      throw new Error(`Update check failed: HTTP ${res.status}`);
    }

    const data: UpdateInfo = await res.json();

    // Compare version
    const hasNewVersion = data.versionCode > current.versionCode ||
      compareVersions(data.version, current.version) > 0;

    if (!hasNewVersion) {
      config.onNoUpdate?.();
      return null;
    }

    // Check if user skipped this version
    const skipped = await Preferences.get({ key: STORAGE_KEY_SKIPPED_VERSION });
    if (skipped.value === data.version) {
      config.onNoUpdate?.();
      return null;
    }

    // Record check time
    await Preferences.set({
      key: STORAGE_KEY_LAST_CHECK,
      value: Date.now().toString(),
    });

    config.onUpdateAvailable?.(data);
    return data;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    config.onError?.(error);
    return null;
  }
}

/**
 * Check if enough time has passed since the last check.
 */
export async function shouldCheckForUpdate(intervalMs: number = DEFAULT_CHECK_INTERVAL): Promise<boolean> {
  const last = await Preferences.get({ key: STORAGE_KEY_LAST_CHECK });
  if (!last.value) return true;
  const lastTime = parseInt(last.value, 10);
  return Date.now() - lastTime > intervalMs;
}

/**
 * Skip a specific version (user declines update).
 */
export async function skipVersion(version: string): Promise<void> {
  await Preferences.set({ key: STORAGE_KEY_SKIPPED_VERSION, value: version });
}

/**
 * Clear skipped version (so next check will show it again).
 */
export async function clearSkippedVersion(): Promise<void> {
  await Preferences.remove({ key: STORAGE_KEY_SKIPPED_VERSION });
}

/**
 * Download APK to device filesystem.
 * Returns the local file path.
 */
export async function downloadApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
  // Use XMLHttpRequest for progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.responseType = "blob";

    xhr.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress?.({
          loaded: e.loaded,
          total: e.total,
          percent: Math.round((e.loaded / e.total) * 100),
        });
      }
    };

    xhr.onload = async () => {
      if (xhr.status !== 200) {
        reject(new Error(`Download failed: HTTP ${xhr.status}`));
        return;
      }

      try {
        const blob = xhr.response;
        // Convert blob to base64
        const reader = new FileReader();
        reader.onload = async () => {
          const base64Data = (reader.result as string).split(",")[1];
          const filePath = `updates/${filename}`;

          // Ensure directory exists
          try {
            await Filesystem.mkdir({
              path: "updates",
              directory: Directory.Cache,
              recursive: true,
            });
          } catch {
            // Directory might already exist
          }

          // Write file
          await Filesystem.writeFile({
            path: filePath,
            data: base64Data,
            directory: Directory.Cache,
          });

          resolve(filePath);
        };
        reader.onerror = () => reject(new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error("Network error during download"));
    xhr.send();
  });
}

/**
 * Prompt user to install the downloaded APK.
 * On Android, this triggers the package installer.
 */
export async function promptInstall(filePath: string): Promise<void> {
  try {
    // Get the file URI
    const fileUri = await Filesystem.getUri({
      path: filePath,
      directory: Directory.Cache,
    });

    // On Android, open the APK file URI which triggers package installer
    // The intent filter for application/vnd.android.package-archive
    // is handled by the Android OS
    await Browser.open({ url: fileUri.uri });
  } catch {
    // Fallback: share the file via Android share sheet
    try {
      await Share.share({
        title: "Install Printifya",
        text: "Buka file APK untuk install Printifya versi baru",
        files: [filePath],
      });
    } catch {
      throw new Error("Gagal membuka file APK. Coba buka file secara manual.");
    }
  }
}

/**
 * Full update flow: check → download → install prompt.
 */
export async function performUpdate(
  updateInfo: UpdateInfo,
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const filename = `printifya-${updateInfo.version}.apk`;

  if (updateInfo.apkUrl) {
    // Download APK
    onProgress?.({ loaded: 0, total: 1, percent: 0 });
    const filePath = await downloadApk(updateInfo.apkUrl, filename, onProgress);
    onProgress?.({ loaded: 1, total: 1, percent: 100 });

    // Prompt install
    await promptInstall(filePath);
  } else if (updateInfo.releaseUrl) {
    // Open release page in browser
    await Browser.open({ url: updateInfo.releaseUrl });
  } else {
    throw new Error("Tidak ada URL untuk mengunduh update");
  }
}

/**
 * Auto-check for update on app startup (call once).
 */
export async function autoCheckForUpdate(config: UpdateConfig): Promise<void> {
  if (!isNative()) return;

  const checkInterval = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL;
  const shouldCheck = await shouldCheckForUpdate(checkInterval);

  if (shouldCheck) {
    // Non-blocking check
    setTimeout(() => {
      checkForUpdate(config);
    }, 3000); // Wait 3s after app start
  }
}

// ── Example Config ─────────────────────────────────────────────────────────

/**
 * Create an update config for GitHub Releases.
 *
 * @example
 * ```ts
 * import { autoCheckForUpdate, githubUpdateConfig } from "./shared/autoUpdate";
 *
 * const config = githubUpdateConfig({
 *   owner: "printifya",
 *   repo: "printifya-app",
 *   onUpdateAvailable: (info) => showUpdateDialog(info),
 * });
 *
 * autoCheckForUpdate(config);
 * ```
 */
export function githubUpdateConfig(opts: {
  owner: string;
  repo: string;
  checkIntervalMs?: number;
  onUpdateAvailable?: (info: UpdateInfo) => void;
  onNoUpdate?: () => void;
  onError?: (error: Error) => void;
}): UpdateConfig {
  return {
    endpoint: `https://api.github.com/repos/${opts.owner}/${opts.repo}/releases/latest`,
    checkIntervalMs: opts.checkIntervalMs,
    onUpdateAvailable: opts.onUpdateAvailable,
    onNoUpdate: opts.onNoUpdate,
    onError: opts.onError,
  };
}
