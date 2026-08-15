/**
 * Penyimpanan opsi Auto Crop Face ke localStorage (via prefsStorage bersama,
 * pola sama dengan modul AI lain): kunci ber-prefix `printifya.` dan akses
 * dibungkus try/catch.
 *
 * Yang disimpan: proporsi wajah (zoom, padanan `--facePercent` autocrop)
 * yang dipakai sebagai nilai default pada kunjungan berikutnya.
 */

import {
  loadString,
  removeKeys,
  saveString,
} from "../../shared/prefsStorage";

const FACE_PERCENT_KEY = "printifya.auto-crop-face.face-percent";

const DEFAULT_FACE_PERCENT = 50;

/** Baca proporsi wajah tersimpan; fallback 50 (default autocrop). */
export function loadFacePercent(): number {
  const raw = loadString(FACE_PERCENT_KEY, null);
  if (raw === null) return DEFAULT_FACE_PERCENT;
  const n = Number(raw);
  if (Number.isNaN(n)) return DEFAULT_FACE_PERCENT;
  return Math.min(100, Math.max(1, Math.round(n)));
}

export function saveFacePercent(percent: number): void {
  saveString(FACE_PERCENT_KEY, String(Math.round(percent)));
}

/** Hapus kunci localStorage milik modul ini. */
export function clearFacePercent(): void {
  removeKeys(FACE_PERCENT_KEY);
}
