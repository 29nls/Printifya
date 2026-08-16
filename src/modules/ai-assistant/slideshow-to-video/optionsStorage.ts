/**
 * Penyimpanan opsi Slideshow to Video ke localStorage (via prefsStorage
 * bersama, pola sama dengan modul AI lain): kunci ber-prefix `printifya.` dan
 * akses dibungkus try/catch.
 *
 * Yang disimpan: durasi per slide, durasi fade, FPS output, dan resolusi
 * kerja/output — semua divalidasi saat dimuat dengan fallback ke default.
 */

import { loadJSON, removeKeys, saveJSON } from "../../shared/prefsStorage";
import { SLIDESHOW_FPS, SLIDESHOW_RES } from "./slideshow";

const OPTIONS_KEY = "printifya.slideshow-to-video.options";

export interface SlideshowPrefs {
  /** Detik per slide (1–30). */
  slideDur: number;
  /** Detik transisi fade (0–10; dibatasi setengah durasi slide di mesin). */
  fadeDur: number;
  /** FPS output (15/24/30). */
  fps: number;
  /** Id resolusi kerja/output (lihat SLIDESHOW_RES). */
  resId: string;
}

export const DEFAULT_SLIDESHOW_PREFS: SlideshowPrefs = {
  slideDur: 3,
  fadeDur: 1,
  fps: 30,
  resId: "1080",
};

/** Baca preferensi tersimpan; fallback penuh ke default bila rusak/baru. */
export function loadSlideshowPrefs(): SlideshowPrefs {
  const loaded = loadJSON<SlideshowPrefs>(OPTIONS_KEY, (v) => {
    if (!v || typeof v !== "object") return null;
    const p = v as Partial<SlideshowPrefs>;
    const num = (x: unknown, dflt: number, min: number, max: number) =>
      typeof x === "number" && Number.isFinite(x)
        ? Math.min(max, Math.max(min, x))
        : dflt;
    const fpsOk =
      typeof p.fps === "number" &&
      (SLIDESHOW_FPS as readonly number[]).includes(p.fps);
    const resOk =
      typeof p.resId === "string" &&
      SLIDESHOW_RES.some((r) => r.id === p.resId);
    return {
      slideDur: num(p.slideDur, DEFAULT_SLIDESHOW_PREFS.slideDur, 1, 30),
      fadeDur: num(p.fadeDur, DEFAULT_SLIDESHOW_PREFS.fadeDur, 0, 10),
      fps: fpsOk ? (p.fps as number) : DEFAULT_SLIDESHOW_PREFS.fps,
      resId: resOk ? (p.resId as string) : DEFAULT_SLIDESHOW_PREFS.resId,
    };
  });
  return loaded ?? { ...DEFAULT_SLIDESHOW_PREFS };
}

export function saveSlideshowPrefs(prefs: SlideshowPrefs): void {
  saveJSON(OPTIONS_KEY, prefs);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearSlideshowOptions(): void {
  removeKeys(OPTIONS_KEY);
}
