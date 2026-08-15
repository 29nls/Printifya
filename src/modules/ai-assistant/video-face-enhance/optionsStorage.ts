/**
 * Penyimpanan opsi Video Face Enhance ke localStorage (via prefsStorage
 * bersama, pola sama dengan modul AI lain): kunci ber-prefix `printifya.` dan
 * akses dibungkus try/catch.
 *
 * Yang disimpan: semua parameter pipeline (fidelitas w, pemulusan, ketajaman,
 * koreksi warna, perbaikan latar, pemulihan warna, koherensi temporal, fps,
 * resolusi kerja, format output) + awalan label terusan ke Auto Layout — semua
 * field divalidasi saat dimuat dengan fallback ke default.
 */

import { loadJSON, removeKeys, saveJSON } from "../../shared/prefsStorage";
import {
  DEFAULT_VIDEO_PARAMS,
  FPS_OPTIONS,
  RES_MODES,
  FORMATS,
  type VideoEnhanceParams,
} from "./videoEnhance";

const OPTIONS_KEY = "printifya.video-face-enhance.options";

const DEFAULT_PREFIX = "video-";

export interface VideoFaceEnhancePrefs {
  params: VideoEnhanceParams;
  /** Awalan nama default saat frame dikirim ke Auto Layout (label lembar). */
  layoutPrefix: string;
}

const clamp01 = (x: number) => Math.min(100, Math.max(0, x));

/** Baca preferensi tersimpan; fallback penuh ke default bila rusak/baru. */
export function loadVideoPrefs(): VideoFaceEnhancePrefs {
  const loaded = loadJSON<VideoFaceEnhancePrefs>(OPTIONS_KEY, (v) => {
    if (!v || typeof v !== "object") return null;
    const p = v as Partial<VideoFaceEnhancePrefs>;
    const f = (p.params ?? {}) as Partial<VideoEnhanceParams>;
    const num = (x: unknown, dflt: number) =>
      typeof x === "number" && Number.isFinite(x) ? clamp01(x) : dflt;
    const bool = (x: unknown, dflt: boolean) =>
      typeof x === "boolean" ? x : dflt;
    const oneOf = <T extends string>(
      x: unknown,
      opts: readonly T[],
      dflt: T
    ): T =>
      typeof x === "string" && (opts as readonly string[]).includes(x)
        ? (x as T)
        : dflt;
    return {
      params: {
        fidelity: num(f.fidelity, DEFAULT_VIDEO_PARAMS.fidelity),
        smooth: num(f.smooth, DEFAULT_VIDEO_PARAMS.smooth),
        sharpen: num(f.sharpen, DEFAULT_VIDEO_PARAMS.sharpen),
        color: num(f.color, DEFAULT_VIDEO_PARAMS.color),
        background: bool(f.background, DEFAULT_VIDEO_PARAMS.background),
        restoreColor: bool(f.restoreColor, DEFAULT_VIDEO_PARAMS.restoreColor),
        temporal: num(f.temporal, DEFAULT_VIDEO_PARAMS.temporal),
        fps:
          typeof f.fps === "number" &&
          (FPS_OPTIONS as readonly number[]).includes(f.fps)
            ? f.fps
            : DEFAULT_VIDEO_PARAMS.fps,
        resMode: oneOf(f.resMode, RES_MODES, DEFAULT_VIDEO_PARAMS.resMode),
        format: oneOf(f.format, FORMATS, DEFAULT_VIDEO_PARAMS.format),
      },
      layoutPrefix:
        typeof p.layoutPrefix === "string"
          ? p.layoutPrefix
          : DEFAULT_PREFIX,
    };
  });
  return (
    loaded ?? {
      params: { ...DEFAULT_VIDEO_PARAMS },
      layoutPrefix: DEFAULT_PREFIX,
    }
  );
}

export function saveVideoPrefs(prefs: VideoFaceEnhancePrefs): void {
  saveJSON(OPTIONS_KEY, prefs);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearVideoOptions(): void {
  removeKeys(OPTIONS_KEY);
}
