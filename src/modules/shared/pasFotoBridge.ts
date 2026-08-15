/**
 * Jembatan antar modul dalam satu sesi SPA (navigasi React Router tidak
 * me-reload halaman). Dipakai untuk meneruskan gambar hasil proses (mis.
 * background removal) langsung ke modul pas foto tanpa lewat URL/file.
 *
 * Data URL bisa berukuran besar, jadi tidak disimpan di sessionStorage;
 * cukup variabel in-memory.
 *
 * Catatan: modul tujuan memakai `peekPendingPasFoto` saat mount lalu
 * `clearPendingPasFoto` di efek setelah commit — pola ini aman terhadap
 * double-mount React StrictMode di mode development (mengambil & langsung
 * mengosongkan pada mount pertama yang palsu akan kehilangan nilainya).
 */
let pendingPasFoto: string | null = null;

/** Simpan gambar (data URL) untuk diteruskan ke modul pas foto. */
export function setPendingPasFoto(dataUrl: string | null): void {
  pendingPasFoto = dataUrl;
}

/** Baca gambar tertunda tanpa mengosongkannya; `null` bila tidak ada. */
export function peekPendingPasFoto(): string | null {
  return pendingPasFoto;
}

/** Kosongkan gambar tertunda (dipanggil setelah nilai dikonsumsi). */
export function clearPendingPasFoto(): void {
  pendingPasFoto = null;
}
