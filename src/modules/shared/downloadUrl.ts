/**
 * Unduh URL lewat elemen `<a download>` — pola seragam untuk semua modul
 * (sebelumnya disalin di ~10 tempat: createElement("a") → href → download →
 * click → remove). Kebijakan revoke blob URL terpusat:
 *
 * - URL `blob:` di-revoke setelah unduhan dimulai (jeda default 1000 ms).
 *   Beri `revoke: false` bila URL masih dipakai elemen lain (pratinjau,
 *   perbandingan, strip) atau lifecycle-nya dikelola komponen.
 * - URL `data:` TIDAK pernah di-revoke (inline — tidak ada sumber daya yang
 *   perlu dibebaskan; revoke data URL tidak berpengaruh).
 *
 * Keputusan revoke dipisah ke `shouldRevokeBlobUrl` (murni, bisa diuji);
 * `downloadUrl` hanyalah pembungkus DOM.
 */

export interface DownloadUrlOptions {
  /** Paksa revoke / tidak revoke (default: otomatis — blob: → true, lainnya
   *  termasuk data: → false). */
  revoke?: boolean;
  /** Jeda revoke blob URL dalam ms (default 1000; 0 = segera). */
  revokeDelayMs?: number;
}

/** Apakah URL blob harus di-revoke setelah unduhan dimulai. Murni — diuji
 *  tanpa DOM. URL `data:` dan skema lain tidak pernah di-revoke. */
export function shouldRevokeBlobUrl(
  url: string,
  opts?: DownloadUrlOptions
): boolean {
  return opts?.revoke ?? url.startsWith("blob:");
}

/** Unduh `url` dengan nama file `name` via elemen `<a download>` sementara. */
export function downloadUrl(
  url: string,
  name: string,
  opts: DownloadUrlOptions = {}
): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (shouldRevokeBlobUrl(url, opts)) {
    const delay = opts.revokeDelayMs ?? 1000;
    if (delay > 0) {
      window.setTimeout(() => URL.revokeObjectURL(url), delay);
    } else {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Konversi Blob → data URL (mandiri, tahan revoke object URL). Dipakai
 * terusan antar modul: bridge memakai data URL karena modul tujuan bahkan
 * me-revoke object URL masuknya saat double-mount StrictMode, jadi blob URL
 * tidak aman untuk diteruskan. Base64 via FileReader berjalan di luar thread
 * utama (baca blob async) — jauh lebih ringan daripada `canvas.toDataURL`
 * sinkron pada resolusi penuh.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () =>
      reject(fr.error ?? new Error("Gagal mengonversi hasil ke data URL."));
    fr.readAsDataURL(blob);
  });
}
