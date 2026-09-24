import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Share } from "@capacitor/share";
import { Preferences } from "@capacitor/preferences";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import type { PluginListenerHandle } from "@capacitor/core";
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

/** Folder APK di dalam Directory.Cache (pola sama seperti ApkInstallerPlugin.java). */
const APK_DIR = "updates";

/** Ukuran minimum APK yang masuk akal; di bawah ini hampir pasti halaman error. */
const MIN_APK_BYTES = 100 * 1024;

// ── Helpers ────────────────────────────────────────────────────────────────

async function getCurrentVersion(): Promise<{ version: string; versionCode: number }> {
  try {
    const info = await App.getInfo();
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

function parseVersionCode(version: string): number {
  const parts = version.split(".").map(Number);
  return (parts[0] ?? 0) * 10000 + (parts[1] ?? 0) * 100 + (parts[2] ?? 0);
}

// ── GitHub Releases API ────────────────────────────────────────────────────

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

function parseGitHubRelease(
  release: GitHubRelease,
  owner?: string,
  repo?: string,
): UpdateInfo {
  const version = release.tag_name.replace(/^v/i, "");

  const apkAsset = release.assets.find(
    (a) => a.name.endsWith(".apk") && !a.name.includes("unsigned"),
  );

  let releaseUrl: string | undefined;
  if (owner && repo) {
    releaseUrl = `https://github.com/${owner}/${repo}/releases/tag/${release.tag_name}`;
  } else if (apkAsset) {
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

// ── Check for Update ───────────────────────────────────────────────────────

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

    let data: UpdateInfo;
    if (rawData.tag_name && Array.isArray(rawData.assets)) {
      data = parseGitHubRelease(
        rawData as GitHubRelease,
        config.githubOwner,
        config.githubRepo,
      );
    } else {
      data = rawData as UpdateInfo;
    }

    const hasNewVersion =
      data.versionCode > current.versionCode ||
      compareVersions(data.version, current.version) > 0;

    if (!hasNewVersion) {
      config.onNoUpdate?.();
      return null;
    }

    const skipped = await Preferences.get({
      key: STORAGE_KEY_SKIPPED_VERSION,
    });
    if (skipped.value === data.version) {
      config.onNoUpdate?.();
      return null;
    }

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

export async function shouldCheckForUpdate(
  intervalMs: number = DEFAULT_CHECK_INTERVAL,
): Promise<boolean> {
  const last = await Preferences.get({ key: STORAGE_KEY_LAST_CHECK });
  if (!last.value) return true;
  const lastTime = parseInt(last.value, 10);
  if (isNaN(lastTime)) return true;
  return Date.now() - lastTime > intervalMs;
}

export async function skipVersion(version: string): Promise<void> {
  await Preferences.set({ key: STORAGE_KEY_SKIPPED_VERSION, value: version });
}

export async function clearSkippedVersion(): Promise<void> {
  await Preferences.remove({ key: STORAGE_KEY_SKIPPED_VERSION });
}

// ── Download APK ───────────────────────────────────────────────────────────

/**
 * Convert a Blob to a base64 string (without the data:... prefix).
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      if (!base64) {
        reject(new Error("Failed to encode file"));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Resolve the final download URL by following redirects manually.
 * GitHub's browser_download_url redirects through multiple hops.
 * (Hanya dipakai oleh jalur fetch/web — lihat catatan CORS di downloadApk.)
 */
async function resolveDownloadUrl(url: string): Promise<string> {
  try {
    // Make a HEAD request to follow redirects and get the final URL
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
    });
    return res.url || url;
  } catch {
    // If HEAD fails, try GET with no body
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Consume the response body to allow redirect to complete
      await res.blob();
      return res.url || url;
    } catch {
      return url;
    }
  }
}

/**
 * Terjemahkan error teknis unduhan menjadi pesan yang bisa dimengerti pengguna.
 * "Failed to fetch" adalah pesan generik WebView saat request diblokir
 * (CORS/jaringan) sehingga perlu dijelaskan, bukan ditampilkan mentah.
 */
export function describeUpdateError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : err == null ? "" : String(err);
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return (
      "Unduhan gagal karena koneksi ke server update terputus atau diblokir. " +
      "Periksa internet lalu coba lagi, atau pakai \"Buka di Browser\"."
    );
  }
  if (/abort|timeout/i.test(raw)) {
    return "Unduhan melebihi batas waktu — koneksi terlalu lambat. Coba lagi.";
  }
  return raw || "Gagal mengunduh update.";
}

/**
 * Buka halaman rilis di browser eksternal — jalur penyelamat bila unduhan
 * di dalam aplikasi gagal (pengguna mengunduh APK lewat browser lalu install).
 */
export async function openUpdatePage(info: UpdateInfo): Promise<void> {
  const url = info.releaseUrl ?? info.apkUrl;
  if (!url) throw new Error("Tidak ada tautan rilis untuk dibuka.");

  if (isNative()) {
    await Browser.open({ url });
    return;
  }
  window.open(url, "_blank", "noopener");
}

/**
 * Unduh APK lewat HTTP native (Filesystem.downloadFile), bukan fetch WebView.
 *
 * Alasan: fetch() di WebView tunduk pada CORS, sedangkan endpoint aset GitHub
 * (release-assets.githubusercontent.com) tidak mengirim header
 * Access-Control-Allow-Origin — hasilnya TypeError "Failed to fetch". Jalur
 * native bebas CORS dan sudah mengikuti rantai redirect GitHub 302 → signed URL.
 */
async function downloadApkNative(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  expectedSize?: number,
): Promise<string> {
  const relativePath = `${APK_DIR}/${filename}`;

  let listener: PluginListenerHandle | undefined;
  if (onProgress) {
    listener = await Filesystem.addListener("progress", (status) => {
      const total = status.contentLength || expectedSize || 0;
      onProgress({
        loaded: status.bytes,
        total,
        percent: total > 0 ? Math.round((status.bytes / total) * 100) : 0,
      });
    });
  }

  try {
    await Filesystem.downloadFile({
      url,
      path: relativePath,
      directory: Directory.Cache,
      recursive: true,
      progress: true,
      headers: { Accept: "application/octet-stream" },
    });
  } finally {
    await listener?.remove();
  }

  // Jalur native tidak memeriksa status HTTP (halaman error ikut tertulis),
  // jadi ukurannya diverifikasi sebelum diserahkan ke installer.
  const { size } = await Filesystem.stat({
    path: relativePath,
    directory: Directory.Cache,
  });

  if (expectedSize && expectedSize > 0 && size !== expectedSize) {
    throw new Error(
      `Unduhan tidak lengkap (${size} dari ${expectedSize} byte). Coba lagi.`,
    );
  }
  if (size < MIN_APK_BYTES) {
    throw new Error(`File APK tidak valid (${size} byte). Coba lagi.`);
  }

  onProgress?.({ loaded: size, total: size, percent: 100 });
  return relativePath;
}

/**
 * Apakah errornya berarti "plugin tidak bisa mengunduh sama sekali" (bukan
 * kegagalan unduhan nyata)? Hanya kasus ini yang layak dicoba lewat fetch.
 */
function isNativeDownloadUnavailable(err: unknown): boolean {
  if (typeof Filesystem.downloadFile !== "function") return true;
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    message.includes("not implemented") ||
    message.includes("unimplemented") ||
    message.includes("not available") ||
    message.includes("unknown method")
  );
}

/**
 * Unduh APK ke device filesystem. Di Android memakai HTTP native (tanpa CORS),
 * dengan jalur fetch sebagai cadangan; di web hanya fetch yang tersedia.
 * Mengembalikan path lokal file (relatif terhadap direktori Cache).
 */
export async function downloadApk(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
  expectedSize?: number,
): Promise<string> {
  onProgress?.({ loaded: 0, total: 0, percent: 0 });

  if (isNative()) {
    try {
      return await downloadApkNative(url, filename, onProgress, expectedSize);
    } catch (err) {
      // Kegagalan unduhan nyata diteruskan apa adanya — fetch di WebView tetap
      // diblokir CORS untuk aset GitHub, jadi menutupinya hanya menyamarkan sebab.
      if (!isNativeDownloadUnavailable(err)) throw err;
    }
  }

  return downloadApkViaFetch(url, filename, onProgress);
}

/**
 * Jalur unduhan berbasis fetch — dipakai di web dan sebagai cadangan di native.
 * Membaca body sebagai stream sehingga progres byte bisa dilaporkan.
 */
async function downloadApkViaFetch(
  url: string,
  filename: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<string> {
  // Step 1: Resolve the final download URL (follow GitHub redirects)
  let finalUrl = url;
  try {
    finalUrl = await resolveDownloadUrl(url);
  } catch {
    // If resolve fails, try the original URL
    finalUrl = url;
  }

  // Step 2: Download using fetch with progress tracking via ReadableStream
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

  try {
    const res = await fetch(finalUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/octet-stream",
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length")) || 0;
    const reader = res.body?.getReader();

    if (!reader) {
      throw new Error("Cannot read response body");
    }

    const chunks: Uint8Array[] = [];
    let loaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;

      if (contentLength > 0) {
        onProgress?.({
          loaded,
          total: contentLength,
          percent: Math.round((loaded / contentLength) * 100),
        });
      } else {
        onProgress?.({
          loaded,
          total: 0,
          percent: 0,
        });
      }
    }

    // Combine chunks into a single Uint8Array
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    if (totalBytes === 0) {
      throw new Error("Downloaded file is empty");
    }

    onProgress?.({ loaded: totalBytes, total: totalBytes, percent: 100 });

    // Step 3: Convert to base64 and write to filesystem
    const blob = new Blob([combined], { type: "application/vnd.android.package-archive" });
    const base64Data = await blobToBase64(blob);
    const filePath = `${APK_DIR}/${filename}`;

    try {
      await Filesystem.mkdir({
        path: APK_DIR,
        directory: Directory.Cache,
        recursive: true,
      });
    } catch {
      // Directory might already exist
    }

    await Filesystem.writeFile({
      path: filePath,
      data: base64Data,
      directory: Directory.Cache,
    });

    return filePath;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Download timeout — koneksi terlalu lambat");
    }
    throw err;
  }
}

// ── Install APK ────────────────────────────────────────────────────────────

/**
 * Android 8+ memblokir pemasangan APK sampai pengguna mengaktifkan
 * "Install aplikasi tidak dikenal" untuk Printifya. Error ini dibedakan supaya
 * dialog bisa menawarkan tombol "Buka Pengaturan" alih-alih pesan generik.
 */
export class InstallPermissionError extends Error {
  constructor() {
    super(
      "Android memblokir pemasangan: aktifkan izin \"Install aplikasi tidak " +
        "dikenal\" untuk Printifya. Update lanjut otomatis setelah Anda kembali " +
        "ke aplikasi — atau tekan Coba Lagi.",
    );
    this.name = "InstallPermissionError";
  }
}

/**
 * Apakah aplikasi boleh memasang APK? APK lama (tanpa method native ini)
 * dianggap boleh — installer-lah yang akan memutuskan saat itu juga.
 */
export async function canInstallApk(): Promise<boolean> {
  if (!isNative()) return false;
  if (typeof ApkInstaller.canInstallPackages !== "function") return true;

  try {
    const result = await ApkInstaller.canInstallPackages();
    return result?.granted !== false;
  } catch {
    // Sekali error jangan kunci pengguna: biarkan installer Android memutuskan.
    return true;
  }
}

/**
 * Buka layar pengaturan izin pemasangan ("Install aplikasi tidak dikenal")
 * untuk aplikasi ini, sehingga pengguna tidak perlu mencarinya sendiri.
 */
export async function openInstallPermissionSettings(): Promise<void> {
  if (typeof ApkInstaller.openInstallSettings !== "function") {
    throw new Error(
      "Buka Pengaturan Android → Aplikasi → Printifya → Install aplikasi tidak dikenal.",
    );
  }
  await ApkInstaller.openInstallSettings();
}

/**
 * Lempar InstallPermissionError bila izin pemasangan belum ada. Dipanggil
 * sebelum unduhan dimulai agar unduhan besar tidak terbuang sia-sia.
 */
export async function ensureInstallPermission(): Promise<void> {
  if (!isNative()) return;
  if (await canInstallApk()) return;
  throw new InstallPermissionError();
}

export async function promptInstall(filePath: string): Promise<void> {
  if (!isNative()) {
    throw new Error("Auto-update hanya tersedia di aplikasi Android");
  }

  // Izin bisa dicabut lagi setelah unduhan selesai — cek ulang sebelum install.
  await ensureInstallPermission();

  // Strategy 1: Native ApkInstaller plugin with content URI
  try {
    const fileUri = await Filesystem.getUri({
      path: filePath,
      directory: Directory.Cache,
    });
    await ApkInstaller.installApk({ path: fileUri.uri });
    return;
  } catch {
    // Fall through
  }

  // Strategy 2: Native ApkInstaller with relative path
  try {
    await ApkInstaller.installApk({ path: filePath });
    return;
  } catch {
    // Fall through
  }

  // Strategy 3: Share the APK
  try {
    await Share.share({
      title: "Install Printifya",
      text: "Buka file APK untuk install Printifya versi baru",
      files: [filePath],
    });
    return;
  } catch {
    // Fall through
  }

  throw new Error(
    "Gagal membuka installer. Coba download APK dari halaman release.",
  );
}

// ── Perform Update ─────────────────────────────────────────────────────────

export async function performUpdate(
  updateInfo: UpdateInfo,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const filename = `printifya-${updateInfo.version}.apk`;

  if (updateInfo.apkUrl) {
    // Izin pemasangan dicek sebelum unduhan: tanpa izin, unduhan 3+ MB hanya
    // berakhir di penolakan installer.
    await ensureInstallPermission();

    const filePath = await downloadApk(
      updateInfo.apkUrl,
      filename,
      onProgress,
      updateInfo.fileSize,
    );
    await promptInstall(filePath);
  } else if (updateInfo.releaseUrl) {
    await Browser.open({ url: updateInfo.releaseUrl });
  } else {
    throw new Error("Tidak ada URL untuk mengunduh update");
  }
}

// ── Auto Check ─────────────────────────────────────────────────────────────

export async function autoCheckForUpdate(
  config: UpdateConfig,
): Promise<void> {
  if (!isNative()) return;

  const checkInterval = config.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL;
  const shouldCheck = await shouldCheckForUpdate(checkInterval);

  if (shouldCheck) {
    setTimeout(() => {
      checkForUpdate(config);
    }, 3000);
  }
}

// ── Config Helper ──────────────────────────────────────────────────────────

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
