// @vitest-environment jsdom
/**
 * Smoke test mount: setiap grup dan modul harus benar-benar ter-mount.
 *
 * `registry.test.ts` menjaga bentuk data (Component ada, path sah dan unik).
 * Berkas ini menjaga perilakunya: komponen yang lolos pemeriksaan bentuk tetap
 * bisa melempar saat dirender, menggantung di `Suspense` selamanya, atau
 * merender kosong. Ketiganya baru terlihat saat dijalankan.
 *
 * Yang diperiksa per modul:
 *
 * 1. Tidak melempar saat mount.
 * 2. `Suspense` selesai — chunk `lazy()` benar-benar termuat. Modul yang
 *    menggantung akan mentok di sini, bukan mengggantung tes tanpa batas.
 * 3. Merender sesuatu. Menghasilkan DOM kosong adalah kegagalan yang sama
 *    senyapnya dengan `Component: null`.
 * 4. Tidak menulis `console.error`/`console.warn`. Ini yang paling berharga:
 *    `Component: null` dulu dilaporkan React justru lewat jalur ini ("type is
 *    invalid ... got: null"), jadi menangkap log-nya menangkap bug aslinya.
 *
 * Semua modul dipasang di dalam `MemoryRouter` karena sebagian memakai
 * `useNavigate`/`Link`, dan di aplikasi nyata semuanya selalu berada di dalam
 * router. Tanpa router, tiga modul pas foto gagal karena alasan harness, bukan
 * karena cacat.
 */
import { Suspense, act, createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { LEAF_MODULES, MODULES } from "./registry";

declare global {
  // Dipakai React untuk memastikan `act` memang lingkungan tes.
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MountCase {
  /** Nama tes; `$where` di judul diisi dari sini. */
  where: string;
  Component: ComponentType;
}

const MOUNT_CASES: MountCase[] = [
  ...MODULES.map((m) => ({
    where: `grup "${m.id}"`,
    Component: m.Component,
  })),
  ...LEAF_MODULES.map((m) => ({
    where: `modul "${m.id}"`,
    Component: m.Component,
  })),
];

/**
 * Peringatan dari dependensi, bukan dari kode kita. React Router memperingatkan
 * sekali per proses tentang future flag v7; tidak ada yang bisa dilakukan dari
 * sisi modul, jadi diabaikan agar tes tidak berbunyi palsu.
 */
const IGNORED_LOGS = [/React Router Future Flag Warning/];

function isIgnored(line: string): boolean {
  return IGNORED_LOGS.some((re) => re.test(line));
}

interface MountOutcome {
  /** `Suspense` selesai (chunk lazy termuat dan komponen ter-commit). */
  resolved: boolean;
  /** Teks yang benar-benar ter-render, sudah di-trim. */
  text: string;
  /** Pesan bila mount melempar. */
  threw: string | null;
  /** Baris `console.error`/`console.warn` selama mount. */
  logs: string[];
}

/**
 * Pasang `Component`, tunggu chunk lazy-nya, lalu bongkar lagi.
 *
 * Penantian `Suspense` memakai tenggat waktu, bukan jumlah putaran: modul yang
 * benar-benar menggantung tetap dilaporkan gagal, sementara runner CI yang
 * lambat memuat chunk (modul worker seperti upscale-denoise/face-enhance/
 * auto-layout) tidak lagi salah dituduh menggantung.
 */
const SUSPENSE_DEADLINE_MS = 15000;

async function mountAndCapture(Component: ComponentType): Promise<MountOutcome> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const logs: string[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    logs.push("error " + args.map(String).join(" ").slice(0, 200));
  };
  console.warn = (...args: unknown[]) => {
    logs.push("warn " + args.map(String).join(" ").slice(0, 200));
  };

  let threw: string | null = null;
  try {
    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(
            Suspense,
            { fallback: createElement("i", { "data-pending": "1" }) },
            createElement(Component)
          )
        )
      );
    });
    const deadline = Date.now() + SUSPENSE_DEADLINE_MS;
    while (container.querySelector("[data-pending]") && Date.now() < deadline) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }

  const resolved = container.querySelector("[data-pending]") === null;
  const text = (container.textContent ?? "").trim();

  try {
    await act(async () => {
      root.unmount();
    });
  } catch {
    /* Kegagalan unmount dilaporkan lewat `logs`, bukan dilempar ke sini. */
  }
  console.error = originalError;
  console.warn = originalWarn;
  container.remove();

  return { resolved, text, threw, logs };
}

afterEach(() => {
  // Modul boleh menulis preferensi saat mount; bersihkan agar tiap modul
  // di-mount dari kondisi awal yang sama.
  localStorage.clear();
});

describe("mount semua grup dan modul", () => {
  it("ada modul untuk dipasang (tes tidak diam-diam kosong)", () => {
    expect(MOUNT_CASES.length).toBe(MODULES.length + LEAF_MODULES.length);
    expect(MOUNT_CASES.length).toBeGreaterThan(MODULES.length);
  });

  it.each(MOUNT_CASES)(
    "$where ter-mount tanpa error",
    async ({ where, Component }) => {
      const outcome = await mountAndCapture(Component);

      expect(
        outcome.threw,
        `${where} melempar saat mount: ${outcome.threw}`
      ).toBeNull();

      expect(
        outcome.resolved,
        `${where} tidak pernah selesai Suspense (chunk lazy menggantung)`
      ).toBe(true);

      expect(
        outcome.text.length,
        `${where} ter-mount tetapi merender kosong`
      ).toBeGreaterThan(0);

      const takTerduga = outcome.logs.filter((l) => !isIgnored(l));
      expect(
        takTerduga,
        `${where} menulis pesan error/peringatan saat mount`
      ).toEqual([]);
    },
    30000
  );
});
