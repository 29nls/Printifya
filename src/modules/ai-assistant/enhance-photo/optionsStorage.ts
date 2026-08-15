/**
 * Penyimpanan opsi Enhance Photo ke localStorage (via prefsStorage bersama,
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

const PREFIX_KEY = "printifya.enhance-photo.layout-prefix";

const DEFAULT_PREFIX = "enhanced-";

/** Baca awalan label tersimpan; fallback "enhanced-". */
export function loadLayoutPrefix(): string {
  return loadString(PREFIX_KEY, DEFAULT_PREFIX) ?? DEFAULT_PREFIX;
}

export function saveLayoutPrefix(prefix: string): void {
  saveString(PREFIX_KEY, prefix);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearEnhanceOptions(): void {
  removeKeys(PREFIX_KEY);
}
