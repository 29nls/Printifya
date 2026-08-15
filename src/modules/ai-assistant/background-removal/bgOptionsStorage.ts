/**
 * Penyimpanan opsi Background Removal ke localStorage (via prefsStorage
 * bersama, pola sama dengan modul AI lain): kunci ber-prefix `printifya.`
 * dan akses dibungkus try/catch (storage bisa penuh / tidak tersedia).
 *
 * Yang disimpan:
 * - Opsi segmen (padanan rembg): post-process mask, alpha matting, erode size
 *   — dipakai sebagai nilai default pada kunjungan berikutnya.
 * - Awalan label terusan ke Auto Layout.
 */

import {
  loadJSON,
  removeKeys,
  saveJSON,
} from "../../shared/prefsStorage";

export interface BgSegOptions {
  postProcess: boolean;
  matting: boolean;
  erodeSize: number;
}

const SEG_KEY = "printifya.bg-removal.seg-opts";
const PREFIX_KEY = "printifya.bg-removal.layout-prefix";

const DEFAULTS: BgSegOptions = {
  postProcess: true,
  matting: false,
  erodeSize: 10,
};

/** Baca opsi segmen tersimpan (dengan fallback ke default rembg). */
export function loadSegOptions(): BgSegOptions {
  const p = loadJSON<Partial<BgSegOptions>>(SEG_KEY, (value) =>
    value && typeof value === "object"
      ? (value as Partial<BgSegOptions>)
      : null
  );
  if (!p) return { ...DEFAULTS };
  return {
    postProcess:
      typeof p.postProcess === "boolean" ? p.postProcess : DEFAULTS.postProcess,
    matting: typeof p.matting === "boolean" ? p.matting : DEFAULTS.matting,
    erodeSize:
      typeof p.erodeSize === "number"
        ? Math.min(30, Math.max(0, Math.round(p.erodeSize)))
        : DEFAULTS.erodeSize,
  };
}

export function saveSegOptions(opts: BgSegOptions): void {
  saveJSON(SEG_KEY, opts);
}

/** Baca awalan label tersimpan; fallback "bg-". */
export function loadLayoutPrefix(): string {
  return loadJSON<string>(PREFIX_KEY) ?? "bg-";
}

export function saveLayoutPrefix(prefix: string): void {
  saveJSON(PREFIX_KEY, prefix);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearBgOptions(): void {
  removeKeys(SEG_KEY, PREFIX_KEY);
}
