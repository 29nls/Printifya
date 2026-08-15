/**
 * Penyimpanan ukuran kustom (lebar/tinggi/DPI) ke localStorage — via
 * prefsStorage bersama (pola sama dengan modul lain): kunci ber-prefix
 * `printifya.` dan akses dibungkus try/catch.
 */

import {
  loadJSON,
  removeKeys,
  saveJSON,
} from "../../shared/prefsStorage";

export interface CustomSizePrefs {
  widthCm: number;
  heightCm: number;
  dpi: number;
}

const KEY = "printifya.custom-size.size";

const DEFAULTS: CustomSizePrefs = { widthCm: 3, heightCm: 4, dpi: 300 };

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Baca ukuran kustom tersimpan (tervalidasi & ter-clamp); fallback default. */
export function loadCustomSize(): CustomSizePrefs {
  const p = loadJSON<Partial<CustomSizePrefs>>(KEY, (value) =>
    value && typeof value === "object"
      ? (value as Partial<CustomSizePrefs>)
      : null
  );
  if (!p) return { ...DEFAULTS };
  return {
    widthCm:
      typeof p.widthCm === "number" ? clamp(p.widthCm, 0.5, 30) : DEFAULTS.widthCm,
    heightCm:
      typeof p.heightCm === "number" ? clamp(p.heightCm, 0.5, 30) : DEFAULTS.heightCm,
    dpi:
      typeof p.dpi === "number" ? clamp(Math.round(p.dpi), 72, 600) : DEFAULTS.dpi,
  };
}

export function saveCustomSize(p: CustomSizePrefs): void {
  saveJSON(KEY, p);
}

/** Hapus kunci localStorage milik modul ini. */
export function clearCustomSize(): void {
  removeKeys(KEY);
}
