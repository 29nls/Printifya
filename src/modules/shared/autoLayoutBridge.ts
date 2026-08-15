/**
 * Jembatan antar modul untuk meneruskan hasil proses (mis. hasil auto-crop,
 * background removal, atau crop pas foto beberapa orang) langsung ke Auto
 * Layout tanpa lewat URL/file — pola yang sama dengan `pasFotoBridge.ts`.
 *
 * Data URL bisa berukuran besar, jadi cukup variabel in-memory (navigasi
 * React Router tidak me-reload halaman). Mendukung banyak foto sekaligus
 * (mode beberapa orang di pas foto dikirim sebagai satu batch).
 *
 * Modul tujuan memakai `peekPendingLayoutPhotos` saat mount lalu
 * `clearPendingLayoutPhotos` setelah commit — aman terhadap double-mount
 * React StrictMode (mengambil & langsung mengosongkan pada mount pertama
 * yang palsu akan kehilangan nilainya).
 */

export interface PendingLayoutPhoto {
  /** Data URL gambar (mandiri, tidak perlu di-revoke). */
  url: string;
  /** Nama default yang dipakai untuk label di lembar. */
  name: string;
}

let pendingLayoutPhotos: PendingLayoutPhoto[] | null = null;

/** Simpan daftar foto untuk diteruskan ke Auto Layout. */
export function setPendingLayoutPhotos(items: PendingLayoutPhoto[]): void {
  pendingLayoutPhotos = items;
}

/** Simpan satu foto untuk diteruskan ke Auto Layout. */
export function setPendingLayoutPhoto(url: string, name: string): void {
  pendingLayoutPhotos = [{ url, name }];
}

/** Baca daftar foto tertunda tanpa mengosongkannya; `null` bila tidak ada. */
export function peekPendingLayoutPhotos(): PendingLayoutPhoto[] | null {
  return pendingLayoutPhotos;
}

/** Baca foto pertama yang tertunda (pemakaian lama); `null` bila tidak ada. */
export function peekPendingLayoutPhoto(): PendingLayoutPhoto | null {
  return pendingLayoutPhotos && pendingLayoutPhotos.length > 0
    ? pendingLayoutPhotos[0]
    : null;
}

/** Kosongkan foto tertunda (dipanggil setelah nilai dikonsumsi). */
export function clearPendingLayoutPhotos(): void {
  pendingLayoutPhotos = null;
}

/** Alias lama, tetap tersedia untuk kompatibilitas. */
export function clearPendingLayoutPhoto(): void {
  clearPendingLayoutPhotos();
}
