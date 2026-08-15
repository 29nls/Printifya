/**
 * Akses localStorage bersama untuk semua modul (pola try/catch yang sama
 * dengan file *Storage.ts sebelumnya): kegagalan storage (tidak tersedia,
 * penuh, JSON rusak) ditangani dengan fallback — tidak pernah melempar.
 * Kunci diisi pemanggil (konvensi: ber-prefix `printifya.`).
 */

/** Baca nilai JSON dari kunci; `null` bila kunci tidak ada, kosong, atau
 *  rusak. `validator` opsional mengubah/memvalidasi hasil parse dan boleh
 *  mengembalikan `null` untuk menolaknya. */
export function loadJSON<T>(
  key: string,
  validator?: (value: unknown) => T | null
): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return null;
    const parsed = JSON.parse(raw) as unknown;
    return validator ? validator(parsed) : (parsed as T);
  } catch {
    return null;
  }
}

/** Simpan nilai sebagai JSON; gagal diam-diam bila storage penuh / tak ada. */
export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Baca nilai string mentah (bukan JSON); fallback `defaultValue` bila
 *  kunci tidak ada atau akses gagal. */
export function loadString(
  key: string,
  defaultValue: string | null
): string | null {
  try {
    return localStorage.getItem(key) ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/** Simpan nilai string mentah (tanpa JSON); gagal diam-diam bila penuh. */
export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Hapus satu atau beberapa kunci sekaligus; gagal diam-diam. */
export function removeKeys(...keys: string[]): void {
  try {
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // abaikan
  }
}
