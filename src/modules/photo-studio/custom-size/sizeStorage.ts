/**
 * Penyimpanan ukuran kustom (lebar/tinggi/DPI) ke localStorage — pola sama
 * dengan storage.ts Template Surat: kunci ber-prefix `printifya.` dan akses
 * dibungkus try/catch.
 */

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
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<CustomSizePrefs>;
    return {
      widthCm:
        typeof p.widthCm === "number" ? clamp(p.widthCm, 0.5, 30) : DEFAULTS.widthCm,
      heightCm:
        typeof p.heightCm === "number" ? clamp(p.heightCm, 0.5, 30) : DEFAULTS.heightCm,
      dpi:
        typeof p.dpi === "number" ? clamp(Math.round(p.dpi), 72, 600) : DEFAULTS.dpi,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveCustomSize(p: CustomSizePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Hapus kunci localStorage milik modul ini. */
export function clearCustomSize(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // abaikan
  }
}
