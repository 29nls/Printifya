/**
 * Penyimpanan opsi Face Enhance ke localStorage (via prefsStorage bersama,
 * pola sama dengan modul AI lain): kunci ber-prefix `printifya.` dan akses
 * dibungkus try/catch.
 *
 * Yang disimpan: awalan label terusan ke Auto Layout — dipakai sebagai nilai
 * default pada kunjungan berikutnya.
 */

import {
  loadString,
  removeKeys,
  saveString,
} from "../../shared/prefsStorage";

const PREFIX_KEY = "printifya.face-enhance.layout-prefix";
const UPSCALE_KEY = "printifya.face-enhance.upscale";

const DEFAULT_PREFIX = "face-";
const DEFAULT_UPSCALE = 2; // CodeFormer default upscale = 2
const UPSCALE_OPTIONS = ["1", "2", "4"];

/** Baca awalan label tersimpan; fallback "face-". */
export function loadLayoutPrefix(): string {
  return loadString(PREFIX_KEY, DEFAULT_PREFIX) ?? DEFAULT_PREFIX;
}

export function saveLayoutPrefix(prefix: string): void {
  saveString(PREFIX_KEY, prefix);
}

/** Baca faktor perbesaran tersimpan (1/2/4); fallback 2 (default CodeFormer). */
export function loadUpscale(): number {
  const v = loadString(UPSCALE_KEY, String(DEFAULT_UPSCALE));
  return v !== null && UPSCALE_OPTIONS.includes(v) ? Number(v) : DEFAULT_UPSCALE;
}

export function saveUpscale(upscale: number): void {
  saveString(UPSCALE_KEY, String(upscale));
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearFaceEnhanceOptions(): void {
  removeKeys(PREFIX_KEY, UPSCALE_KEY);
}
