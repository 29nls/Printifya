/**
 * Penyimpanan id ukuran/preset aktif ke localStorage (pola sama dengan
 * storage.ts Template Surat): kunci ber-prefix `printifya.` dan akses
 * dibungkus try/catch.
 *
 * Dipakai oleh PasFotoWorkflow lewat prop `sizeStorageKey` — saat diisi,
 * pilihan preset (mis. negara visa) dipersist dan ada tombol reset.
 */

export function readStoredSizeId(key: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null;
  }
}

export function writeStoredSizeId(key: string, id: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(id));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

export function clearStoredSizeId(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // abaikan
  }
}
