/**
 * Penyimpanan id ukuran/preset aktif ke localStorage (via prefsStorage
 * bersama, pola sama dengan modul lain): kunci ber-prefix `printifya.` dan
 * akses dibungkus try/catch.
 *
 * Dipakai oleh PasFotoWorkflow lewat prop `sizeStorageKey` — saat diisi,
 * pilihan preset (mis. negara visa) dipersist dan ada tombol reset.
 */

import {
  loadJSON,
  removeKeys,
  saveJSON,
} from "../../shared/prefsStorage";

export function readStoredSizeId(key: string): string | null {
  return loadJSON<string>(key);
}

export function writeStoredSizeId(key: string, id: string): void {
  saveJSON(key, id);
}

export function clearStoredSizeId(key: string): void {
  removeKeys(key);
}
