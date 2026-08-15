/**
 * Penyimpanan opsi Enhance Photo ke localStorage (pola sama dengan
 * optionsStorage.ts di Auto Crop Face / bgOptionsStorage.ts di Background
 * Removal): kunci ber-prefix `printifya.` dan akses dibungkus try/catch.
 *
 * Yang disimpan: awalan label terusan ke Auto Layout — dipakai sebagai nilai
 * default pada kunjungan berikutnya.
 */

const PREFIX_KEY = "printifya.enhance-photo.layout-prefix";

const DEFAULT_PREFIX = "enhanced-";

/** Baca awalan label tersimpan; fallback "enhanced-". */
export function loadLayoutPrefix(): string {
  try {
    return localStorage.getItem(PREFIX_KEY) ?? DEFAULT_PREFIX;
  } catch {
    return DEFAULT_PREFIX;
  }
}

export function saveLayoutPrefix(prefix: string): void {
  try {
    localStorage.setItem(PREFIX_KEY, prefix);
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearEnhanceOptions(): void {
  try {
    localStorage.removeItem(PREFIX_KEY);
  } catch {
    // abaikan
  }
}
