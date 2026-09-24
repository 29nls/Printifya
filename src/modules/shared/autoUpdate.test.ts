import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Modul Capacitor di-stub seluruhnya: pengujian berjalan di Node (tanpa
// WebView), jadi yang diuji adalah keputusan jalur unduhan & pemetaan error.
const mocks = vi.hoisted(() => ({
  native: { value: true },
  downloadFile: vi.fn(),
  addListener: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  getUri: vi.fn(),
  browserOpen: vi.fn(),
  removeListener: vi.fn(),
  installApk: vi.fn(),
  canInstallPackages: vi.fn(),
  openInstallSettings: vi.fn(),
  plugin: {} as Record<string, unknown>,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native.value },
  registerPlugin: () => mocks.plugin,
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE", Data: "DATA" },
  Filesystem: {
    downloadFile: mocks.downloadFile,
    addListener: mocks.addListener,
    stat: mocks.stat,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    getUri: mocks.getUri,
  },
}));

vi.mock("@capacitor/app", () => ({ App: { getInfo: vi.fn() } }));
vi.mock("@capacitor/browser", () => ({
  Browser: { open: mocks.browserOpen },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import {
  canInstallApk,
  describeUpdateError,
  downloadApk,
  ensureInstallPermission,
  InstallPermissionError,
  openInstallPermissionSettings,
  openUpdatePage,
  performUpdate,
} from "./autoUpdate";

/** FileReader palsu (vitest berjalan di Node tanpa DOM). */
class FakeFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL() {
    this.result = "data:application/octet-stream;base64,QUJD";
    queueMicrotask(() => this.onload?.());
  }
}

const APK_BYTES = 3_344_483;

beforeEach(() => {
  mocks.native.value = true;
  mocks.downloadFile.mockReset();
  mocks.addListener.mockReset();
  mocks.stat.mockReset();
  mocks.writeFile.mockReset();
  mocks.mkdir.mockReset();
  mocks.getUri.mockReset();
  mocks.browserOpen.mockReset();
  mocks.removeListener.mockReset();

  mocks.downloadFile.mockResolvedValue({ path: "/cache/updates/apk" });
  mocks.stat.mockResolvedValue({ size: APK_BYTES });
  mocks.addListener.mockResolvedValue({ remove: mocks.removeListener });
  mocks.writeFile.mockResolvedValue({ uri: "file:///cache/updates/apk" });
  mocks.installApk.mockReset();
  mocks.installApk.mockResolvedValue({ success: true, path: "updates/apk" });
  mocks.canInstallPackages.mockReset();
  mocks.canInstallPackages.mockResolvedValue({ granted: true });
  mocks.openInstallSettings.mockReset();
  mocks.openInstallSettings.mockResolvedValue({ success: true });
  mocks.getUri.mockResolvedValue({ uri: "file:///cache/updates/apk" });
  mocks.plugin.installApk = mocks.installApk;
  mocks.plugin.canInstallPackages = mocks.canInstallPackages;
  mocks.plugin.openInstallSettings = mocks.openInstallSettings;
  // Listener progres native memancarkan satu event lalu selesai.
  mocks.addListener.mockImplementation(
    async (_event: string, listener: (p: unknown) => void) => {
      listener({ url: "https://example.com/a.apk", bytes: 10, contentLength: 40 });
      listener({ url: "https://example.com/a.apk", bytes: 40, contentLength: 40 });
      return { remove: mocks.removeListener };
    }
  );

  vi.stubGlobal("FileReader", FakeFileReader);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs?.();
});

describe("describeUpdateError — pesan teknis jadi pesan pengguna", () => {
  it('"Failed to fetch" dijelaskan + arahkan ke Buka di Browser', () => {
    const msg = describeUpdateError(new TypeError("Failed to fetch"));
    expect(msg).toContain("terputus atau diblokir");
    expect(msg).toContain("Buka di Browser");
  });

  it("error jaringan varian lain (Safari/iOS) juga dikenali", () => {
    expect(describeUpdateError(new TypeError("Load failed"))).toContain(
      "terputus atau diblokir"
    );
    expect(describeUpdateError(new Error("Network request failed"))).toContain(
      "terputus atau diblokir"
    );
  });

  it("timeout/abort -> pesan koneksi lambat", () => {
    expect(
      describeUpdateError(new Error("Download timeout — koneksi terlalu lambat"))
    ).toContain("terlalu lambat");
  });

  it("error lain diteruskan apa adanya; pesan kosong punya fallback", () => {
    expect(describeUpdateError(new Error("HTTP 404"))).toBe("HTTP 404");
    expect(describeUpdateError(new Error(""))).toBe("Gagal mengunduh update.");
    expect(describeUpdateError(undefined)).toBe("Gagal mengunduh update.");
  });
});

describe("downloadApk — jalur native (bebas CORS)", () => {
  it("memakai Filesystem.downloadFile, bukan fetch, di Android", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const path = await downloadApk(
      "https://github.com/29nls/Printifya/releases/download/v1.4.0/Printifya.apk",
      "printifya-1.4.0.apk",
      undefined,
      APK_BYTES
    );

    expect(path).toBe("updates/printifya-1.4.0.apk");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringContaining("releases/download/v1.4.0"),
        path: "updates/printifya-1.4.0.apk",
        directory: "CACHE",
        recursive: true,
        progress: true,
      })
    );
  });

  it("melaporkan progres byte dan berakhir di 100%", async () => {
    const seen: number[] = [];
    await downloadApk("https://example.com/a.apk", "a.apk", (p) => {
      seen.push(p.percent);
    });

    expect(seen[0]).toBe(0); // progres awal sebelum unduhan dimulai
    expect(seen).toContain(25); // 10/40 byte dari listener native
    expect(seen[seen.length - 1]).toBe(100);
  });

  it("selalu melepas listener progres", async () => {
    await downloadApk("https://example.com/a.apk", "a.apk", () => undefined);
    expect(mocks.removeListener).toHaveBeenCalled();
  });

  it("menolak unduhan tidak lengkap (ukuran tak cocok)", async () => {
    mocks.stat.mockResolvedValue({ size: 1024 });
    await expect(
      downloadApk("https://example.com/a.apk", "a.apk", undefined, APK_BYTES)
    ).rejects.toThrow(/tidak lengkap/);
    // Tanpa expectedSize, ukuran kecil tetap ditolak oleh batas minimum.
    await expect(
      downloadApk("https://example.com/a.apk", "a.apk")
    ).rejects.toThrow(/tidak valid/);
  });

  it("jatuh ke jalur fetch bila plugin tak menyediakan unduhan native", async () => {
    mocks.downloadFile.mockRejectedValue(
      new Error("Filesystem.downloadFile is not implemented on android")
    );
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 302 })
        : new Response(new Uint8Array([1, 2, 3, 4]), {
            status: 200,
            headers: { "content-length": "4" },
          })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const path = await downloadApk("https://example.com/a.apk", "a.apk");

    expect(fetchSpy).toHaveBeenCalled();
    expect(path).toBe("updates/a.apk");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: "updates/a.apk", directory: "CACHE" })
    );
  });

  it("kegagalan unduhan native nyata diteruskan, tanpa fallback fetch", async () => {
    mocks.downloadFile.mockRejectedValue(new Error("Error downloading file: timeout"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(downloadApk("https://example.com/a.apk", "a.apk")).rejects.toThrow(
      /Error downloading file/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("di web (bukan native) langsung memakai jalur fetch", async () => {
    mocks.native.value = false;
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "HEAD"
        ? new Response(null, { status: 302 })
        : new Response(new Uint8Array([1, 2]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    await downloadApk("https://example.com/a.apk", "a.apk");

    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("openUpdatePage — jalur penyelamat", () => {
  it("membuka halaman rilis lewat browser native", async () => {
    await openUpdatePage({
      version: "1.4.0",
      versionCode: 10400,
      apkUrl: "https://example.com/Printifya.apk",
      releaseUrl: "https://github.com/29nls/Printifya/releases/tag/v1.4.0",
    });
    expect(mocks.browserOpen).toHaveBeenCalledWith({
      url: "https://github.com/29nls/Printifya/releases/tag/v1.4.0",
    });
  });

  it("memakai apkUrl bila releaseUrl tidak ada", async () => {
    await openUpdatePage({
      version: "1.4.0",
      versionCode: 10400,
      apkUrl: "https://example.com/Printifya.apk",
    });
    expect(mocks.browserOpen).toHaveBeenCalledWith({
      url: "https://example.com/Printifya.apk",
    });
  });

  it("tanpa tautan sama sekali -> error yang bisa dibaca", async () => {
    await expect(
      openUpdatePage({ version: "1.4.0", versionCode: 10400 })
    ).rejects.toThrow("Tidak ada tautan rilis untuk dibuka.");
  });
});

describe('izin pemasangan ("Install aplikasi tidak dikenal")', () => {
  const apk = {
    version: "9.9.9",
    versionCode: 90909,
    apkUrl: "https://example.com/Printifya.apk",
    fileSize: APK_BYTES,
  };

  it("canInstallApk: false di web, mengikuti plugin di Android", async () => {
    mocks.native.value = false;
    expect(await canInstallApk()).toBe(false);

    mocks.native.value = true;
    mocks.canInstallPackages.mockResolvedValue({ granted: false });
    expect(await canInstallApk()).toBe(false);

    mocks.canInstallPackages.mockResolvedValue({ granted: true });
    expect(await canInstallApk()).toBe(true);
  });

  it("APK lama tanpa method native dianggap boleh (installer yang memutuskan)", async () => {
    delete mocks.plugin.canInstallPackages;
    expect(await canInstallApk()).toBe(true);
  });

  it("kegagalan cek izin tidak mengunci pengguna", async () => {
    mocks.canInstallPackages.mockRejectedValue(new Error("boom"));
    expect(await canInstallApk()).toBe(true);
  });

  it("ensureInstallPermission melempar InstallPermissionError bila ditolak", async () => {
    mocks.canInstallPackages.mockResolvedValue({ granted: false });
    await expect(ensureInstallPermission()).rejects.toBeInstanceOf(
      InstallPermissionError
    );
  });

  it("pesan izin tetap terbaca setelah describeUpdateError", () => {
    expect(describeUpdateError(new InstallPermissionError())).toContain(
      "Install aplikasi tidak dikenal"
    );
  });

  it("performUpdate berhenti SEBELUM mengunduh bila izin belum ada", async () => {
    mocks.canInstallPackages.mockResolvedValue({ granted: false });

    await expect(performUpdate(apk)).rejects.toBeInstanceOf(
      InstallPermissionError
    );
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.installApk).not.toHaveBeenCalled();
  });

  it("setelah izin diberikan, unduhan dan installer dijalankan", async () => {
    await performUpdate(apk);

    expect(mocks.downloadFile).toHaveBeenCalled();
    expect(mocks.canInstallPackages).toHaveBeenCalledTimes(2); // pra-unduh + pra-install
    expect(mocks.installApk).toHaveBeenCalled();
  });

  it("openInstallPermissionSettings mengantar ke layar pengaturan izin", async () => {
    await openInstallPermissionSettings();
    expect(mocks.openInstallSettings).toHaveBeenCalled();
  });

  it("tanpa method pengaturan, pengguna diberi jalur manual yang jelas", async () => {
    delete mocks.plugin.openInstallSettings;
    await expect(openInstallPermissionSettings()).rejects.toThrow(
      /Pengaturan Android/
    );
  });
});
