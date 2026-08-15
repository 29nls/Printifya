/**
 * Penyimpanan opsi Upscale & Denoise ke localStorage (pola sama dengan
 * bgOptionsStorage.ts di Background Removal): kunci ber-prefix `printifya.`
 * dan akses dibungkus try/catch.
 *
 * Yang disimpan:
 * - Pengaturan proses (skala, denoise, TTA, format, kualitas) — dipakai
 *   sebagai nilai default pada kunjungan berikutnya.
 * - Awalan label terusan ke Auto Layout.
 */

export interface W2xOptions {
  scaleId: string; // "2x" | "4x" | "8x" | "custom"
  customScale: number;
  denoise: number; // 0–3
  tta: boolean;
  outFormat: string; // "png" | "webp" | "jpg"
  quality: number;
}

const OPTIONS_KEY = "printifya.upscale-denoise.options";
const PREFIX_KEY = "printifya.upscale-denoise.layout-prefix";

const SCALE_IDS = ["2x", "4x", "8x", "custom"];
const FORMATS = ["png", "webp", "jpg"];

export const DEFAULT_W2X_OPTIONS: W2xOptions = {
  scaleId: "4x",
  customScale: 3,
  denoise: 0,
  tta: false,
  outFormat: "png",
  quality: 92,
};

const DEFAULT_PREFIX = "waifu2x-";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/** Baca pengaturan proses tersimpan (tiap field divalidasi). */
export function loadW2xOptions(): W2xOptions {
  const p = read<Partial<W2xOptions>>(OPTIONS_KEY);
  if (!p) return { ...DEFAULT_W2X_OPTIONS };
  return {
    scaleId:
      typeof p.scaleId === "string" && SCALE_IDS.includes(p.scaleId)
        ? p.scaleId
        : DEFAULT_W2X_OPTIONS.scaleId,
    customScale:
      typeof p.customScale === "number"
        ? clamp(Math.round(p.customScale * 2) / 2, 1, 8)
        : DEFAULT_W2X_OPTIONS.customScale,
    denoise:
      typeof p.denoise === "number" && [0, 1, 2, 3].includes(p.denoise)
        ? p.denoise
        : DEFAULT_W2X_OPTIONS.denoise,
    tta:
      typeof p.tta === "boolean" ? p.tta : DEFAULT_W2X_OPTIONS.tta,
    outFormat:
      typeof p.outFormat === "string" && FORMATS.includes(p.outFormat)
        ? p.outFormat
        : DEFAULT_W2X_OPTIONS.outFormat,
    quality:
      typeof p.quality === "number"
        ? clamp(Math.round(p.quality), 50, 100)
        : DEFAULT_W2X_OPTIONS.quality,
  };
}

export function saveW2xOptions(opts: W2xOptions): void {
  write(OPTIONS_KEY, opts);
}

/** Baca awalan label tersimpan; fallback "waifu2x-". */
export function loadLayoutPrefix(): string {
  return read<string>(PREFIX_KEY) ?? DEFAULT_PREFIX;
}

export function saveLayoutPrefix(prefix: string): void {
  write(PREFIX_KEY, prefix);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearW2xOptions(): void {
  try {
    localStorage.removeItem(OPTIONS_KEY);
    localStorage.removeItem(PREFIX_KEY);
  } catch {
    // abaikan
  }
}
