/**
 * Penyimpanan opsi Auto Crop Face ke localStorage (pola sama dengan
 * bgOptionsStorage.ts di Background Removal / storage.ts di Template Surat):
 * kunci ber-prefix `printifya.` dan akses dibungkus try/catch.
 *
 * Yang disimpan: proporsi wajah (zoom, padanan `--facePercent` autocrop)
 * yang dipakai sebagai nilai default pada kunjungan berikutnya.
 */

const FACE_PERCENT_KEY = "printifya.auto-crop-face.face-percent";

const DEFAULT_FACE_PERCENT = 50;

/** Baca proporsi wajah tersimpan; fallback 50 (default autocrop). */
export function loadFacePercent(): number {
  try {
    const raw = localStorage.getItem(FACE_PERCENT_KEY);
    if (raw === null) return DEFAULT_FACE_PERCENT;
    const n = Number(raw);
    if (Number.isNaN(n)) return DEFAULT_FACE_PERCENT;
    return Math.min(100, Math.max(1, Math.round(n)));
  } catch {
    return DEFAULT_FACE_PERCENT;
  }
}

export function saveFacePercent(percent: number): void {
  try {
    localStorage.setItem(FACE_PERCENT_KEY, String(Math.round(percent)));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Hapus kunci localStorage milik modul ini. */
export function clearFacePercent(): void {
  try {
    localStorage.removeItem(FACE_PERCENT_KEY);
  } catch {
    // abaikan
  }
}
