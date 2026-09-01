import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { ApkInstaller } from "./apkInstaller";

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
  /** GitHub owner (for constructing release URLs) */
  githubOwner?: string;
  /** GitHub repo name (for constructing release URLs) */
  githubRepo?: string;
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

/**
 * Get current app version from Capacitor.
 * Properly extracts versionCode from build.gradle via version string.
 */
async function getCurrentVersion(): Promise<{ version: string; versionCode: number }> {
  try {
    const info = await App.getInfo();
    // info.version comes from build.gradle versionName (e.g. "1.1.8")
    // We parse versionCode from it since App.getInfo() may not expose it directly
    return {
      version: info.version,
      versionCode: parseVersionCode(info.version),
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

// ── GitHub Releases API Response ──────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

// ── Main API ───────────────────────────────────────────────────────────────

/**
 * Parse version string to numeric code (e.g., "1.2.3" → 10203).
 */
function parseVersionCode(version: string): number {
  const parts = version.split(".").map(Number);
  return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
}

/**
 * Parse GitHub Releases API response into UpdateInfo.
 */
function parseGitHubRelease(
  release: GitHubRelease,
  owner?: string,
  repo?: string,
): UpdateInfo {
  // Extract version from tag (remove 'v' prefix)
  const version = release.tag_name.replace(/^v/i, "");

  // Find APK asset
  const apkAsset = release.assets.find(
    (a) => a.name.endsWith(".apk") && !a.name.includes("unsigned"),
  );

  // Build correct release URL
  let releaseUrl: string | undefined;
  if (owner && repo) {
    releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${release.tag_name}`;
  } else if (apkAsset) {
    // Fallback: use the download URL of the APK itself
    releaseUrl = apkAsset.browser_download_url;
  }

  return {
    version,
    versionCode: parseVersionCode(version),
    notes: release.body ?? undefined,
    apkUrl: apkAsset?.browser_download_url,
    releaseUrl,
    fileSize: apkAsset?.size,
    releaseDate: release.published_at,
  };
}

/**
 * Check for app updates from a remote endpoint.
 *
 * Supports two formats:
 * 1. GitHub Releases API (tag-based): https://api.github.com/repos/{owner}/{repo}/releases/latest
 * 2. Custom JSON: { version, versionCode, notes, apkUrl, ... }
 */
export async function checkForUpdate(
  config: UpdateConfig,
): Promise<UpdateInfo | null> {
  if (!isNative()) return null;

  try {
    const current = await getCurrentVersion();
    const res = await fetch(config.endpoint, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!res.ok) {
      throw new Error(`Update check failed: HTTP ${res.status}`);
    }

    const rawData = await res.json();

    // Detect GitHub Releases API response vs custom JSON
    let data: UpdateInfo;
    if (rawData.tag_name && Array.isArray(rawData.assets)) {
      // GitHub Releases API format
      data = parseGitHubRelease(
        rawData as GitHubRelease,
        config.githubOwner,
        config.githubRepo,
      );
    } else {
      // Custom JSON format
      data = rawData as UpdateInfo;
    }

    // Compare version
    const hasNewVersion =
      data.versionCode > current.versionCode ||
      compareVersions(data.version, current.version) > 0;

    if (!hasNewVersion) {
      config.onNoUpdate?.();
      return null;
    }

    // Check if user skipped this version
    const skipped = await Preferences.get({
      key: STORAGE_KEY_SKIPPED_VERSION,
    });
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
export async function shouldCheckForUpdate(
  intervalMs: number = DEFAULT_CHECK_INTERVAL,
): Promise<boolean> {
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
  onProgress?: (progress: DownloadProgress) => void,
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
 * Uses native ApkInstaller plugin on Android for direct package installer.
 */
export async function promptInstall(filePath: string): Promise<void> {
  if (isNative()) {
    try {
      // Get the full filesystem URI for the APK
      const fileUri = await Filesystem.getUri({
        path: filePath,
        directory: Directory.Cache,
      });

      // Use native plugin to open the APK with Android package installer
      await ApkInstaller.installApk({ path: fileUri.uri });
      return;
    } catch {
      // Fallback: try with direct path
      try {
        const fileInfo = await Filesystem.stat({
          path: filePath,
          directory: Directory.Cache,
        });
        if (fileInfo && fileInfo.uri) {
          await ApkInstaller.installApk({ path: fileInfo.uri });
          return;
        }
      } catch {
        // Continue to share fallback
      }

      // Fallback: share the APK via Android share sheet
      try {
        await Share.share({
          title: "Install Printifya",
          text: "Buka file APK untuk install Printifya versi baru",
          files: [filePath],
        });
        return;
      } catch {
        // Last resort: open release page
        throw new Error(
          "Gagal membuka installer. Coba download APK dari halaman release.",
        );
      }
    }
  }

  // Web fallback: nothing to do
  throw new Error("Auto-update hanya tersedia di aplikasi Android");
}

/**
 * Full update flow: check → download → install prompt.
 */
export async function performUpdate(
  updateInfo: UpdateInfo,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const filename = `printifya-${updateInfo.version}.apk`;

  if (updateInfo.apkUrl) {
    // Download APK
    onProgress?.({ loaded: 0, total: 1, percent: 0 });
    const filePath = await downloadApk(
      updateInfo.apkUrl,
      filename,
      onProgress,
    );
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
export async function autoCheckForUpdate(
  config: UpdateConfig,
): Promise<void> {
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
    githubOwner: opts.owner,
    githubRepo: opts.repo,
    checkIntervalMs: opts.checkIntervalMs,
    onUpdateAvailable: opts.onUpdateAvailable,
    onNoUpdate: opts.onNoUpdate,
    onError: opts.onError,
  };
}
