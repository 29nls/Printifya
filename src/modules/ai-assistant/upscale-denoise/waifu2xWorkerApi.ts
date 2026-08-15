import type { ProcessOptions, OutFormat } from "./waifu2x";

/**
 * Kontrak pesan worker pipeline (waifu2x.worker.ts). Types-only — impor
 * dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 */

/** Permintaan: satu gambar + opsi pipeline. `bitmap` dikirim via transfer. */
export interface Waifu2xWorkerRequest {
  id: number;
  bitmap: ImageBitmap;
  options: ProcessOptions;
  format: OutFormat;
  quality: number;
}

/** Balasan: blob hasil (URL tampilan/unduh) + ImageBitmap hasil (referensi
 *  perbandingan format, dikirim via transfer) atau error. */
export type Waifu2xWorkerResponse =
  | {
      id: number;
      ok: true;
      blob: Blob;
      width: number;
      height: number;
      bitmap: ImageBitmap;
    }
  | { id: number; ok: false; error: string };
