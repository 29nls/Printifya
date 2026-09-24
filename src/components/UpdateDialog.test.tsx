// @vitest-environment jsdom
/**
 * Uji perilaku dialog update pada kasus izin pemasangan.
 *
 * Yang dijaga di sini adalah alur yang paling mudah rusak diam-diam:
 * pengguna diantar ke Pengaturan izin (aplikasi ke belakang), lalu kembali —
 * update harus lanjut sendiri tanpa menekan "Coba Lagi". `autoUpdate.test.ts`
 * menguji lapisan izin/unduhannya; berkas ini menguji sambungannya ke UI.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // Dipakai React untuk memastikan `act` memang lingkungan tes.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  native: { value: true },
  downloadFile: vi.fn(),
  addListener: vi.fn(),
  stat: vi.fn(),
  getUri: vi.fn(),
  installApk: vi.fn(),
  canInstallPackages: vi.fn(),
  openInstallSettings: vi.fn(),
  browserOpen: vi.fn(),
  plugin: {} as Record<string, unknown>,
  /** Handler `appStateChange` yang dipasang dialog, untuk disimulasikan. */
  appStateHandler: null as null | ((state: { isActive: boolean }) => void),
  appListenerRemoved: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mocks.native.value },
  registerPlugin: () => mocks.plugin,
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (event: string, handler: (s: unknown) => void) => {
      if (event === "appStateChange") mocks.appStateHandler = handler as never;
      return { remove: mocks.appListenerRemoved };
    }),
  },
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE", Data: "DATA" },
  Filesystem: {
    downloadFile: mocks.downloadFile,
    addListener: mocks.addListener,
    stat: mocks.stat,
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    getUri: mocks.getUri,
  },
}));

vi.mock("@capacitor/browser", () => ({
  Browser: { open: mocks.browserOpen },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}));

import UpdateDialog from "./UpdateDialog";

const UPDATE_INFO = {
  version: "9.9.9",
  versionCode: 90909,
  apkUrl: "https://example.com/Printifya.apk",
  releaseUrl: "https://github.com/29nls/Printifya/releases/tag/v9.9.9",
  fileSize: 3_344_483,
};

let container: HTMLDivElement;
let root: Root;

function byText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === text
  );
  if (!button) throw new Error(`Tombol "${text}" tidak ditemukan`);
  return button as HTMLButtonElement;
}

/** Klik lalu biarkan microtask/promise di dalam handler selesai. */
async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
  });
}

/** Simulasikan aplikasi kembali ke depan. */
async function resume() {
  await act(async () => {
    mocks.appStateHandler?.({ isActive: true });
    await Promise.resolve();
  });
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(UpdateDialog, {
        updateInfo: UPDATE_INFO,
        currentVersion: "1.0.0",
        onDismiss: () => undefined,
        onSkip: () => undefined,
      })
    );
  });
}

beforeEach(() => {
  mocks.native.value = true;
  mocks.appStateHandler = null;
  mocks.downloadFile.mockReset().mockResolvedValue({ path: "/cache/apk" });
  mocks.addListener.mockReset().mockResolvedValue({ remove: vi.fn() });
  mocks.stat.mockReset().mockResolvedValue({ size: UPDATE_INFO.fileSize });
  mocks.getUri
    .mockReset()
    .mockResolvedValue({ uri: "file:///cache/updates/printifya-9.9.9.apk" });
  mocks.installApk.mockReset().mockResolvedValue({ success: true, path: "apk" });
  mocks.canInstallPackages
    .mockReset()
    .mockResolvedValue({ granted: false });
  mocks.openInstallSettings.mockReset().mockResolvedValue({ success: true });
  mocks.browserOpen.mockReset();
  mocks.appListenerRemoved.mockReset();
  mocks.plugin.installApk = mocks.installApk;
  mocks.plugin.canInstallPackages = mocks.canInstallPackages;
  mocks.plugin.openInstallSettings = mocks.openInstallSettings;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("UpdateDialog — izin pemasangan", () => {
  it("tanpa izin: unduhan tidak dimulai dan yang muncul tombol Buka Pengaturan", async () => {
    await mount();
    await click(byText("Update Sekarang"));

    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(byText("Buka Pengaturan")).toBeTruthy();
    expect(document.body.textContent).toContain("Install aplikasi tidak dikenal");
  });

  it("setelah izin aktif dan pengguna kembali, update lanjut otomatis", async () => {
    await mount();
    await click(byText("Update Sekarang"));
    await click(byText("Buka Pengaturan"));

    expect(mocks.openInstallSettings).toHaveBeenCalled();
    expect(document.body.textContent).toContain("dilanjutkan");

    // Pengguna mengaktifkan izin di Pengaturan lalu kembali ke aplikasi.
    mocks.canInstallPackages.mockResolvedValue({ granted: true });
    await resume();

    expect(mocks.downloadFile).toHaveBeenCalled();
    expect(mocks.installApk).toHaveBeenCalled();
    expect(document.body.textContent).toContain("Membuka installer");
  });

  it("kembali tanpa mengaktifkan izin: tidak ada unduhan, pesan tetap", async () => {
    await mount();
    await click(byText("Update Sekarang"));
    await click(byText("Buka Pengaturan"));

    await resume();

    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Install aplikasi tidak dikenal");
  });

  it("selesai otomatis sekali saja walau kembali berkali-kali", async () => {
    await mount();
    await click(byText("Update Sekarang"));
    await click(byText("Buka Pengaturan"));
    mocks.canInstallPackages.mockResolvedValue({ granted: true });

    await resume();
    await resume();

    expect(mocks.downloadFile).toHaveBeenCalledTimes(1);
  });

  it("tanpa membuka Pengaturan, kembali ke aplikasi tidak memicu apa pun", async () => {
    await mount();
    await click(byText("Update Sekarang"));

    mocks.canInstallPackages.mockResolvedValue({ granted: true });
    await resume();

    expect(mocks.downloadFile).not.toHaveBeenCalled();
  });

  it("error jaringan biasa tetap menawarkan Buka di Browser", async () => {
    mocks.downloadFile.mockRejectedValue(new TypeError("Failed to fetch"));
    mocks.canInstallPackages.mockResolvedValue({ granted: true });

    await mount();
    await click(byText("Update Sekarang"));

    expect(byText("Buka di Browser")).toBeTruthy();
    expect(document.body.textContent).toContain("diblokir");
  });
});
