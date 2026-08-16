/**
 * Kontrak pesan worker Enhance Photo (enhancePhoto.worker.ts). Types-only —
 * impor dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Satu jenis pesan: "process" — jalankan pipeline full-res (`enhancePixels`,
 * sumber tunggal yang sama dengan `enhanceImage` pratinjau) pada piksel RGBA
 * yang dikirim via transfer, lalu encode PNG DI WORKER (OffscreenCanvas
 * `convertToBlob`). Hasil keluar sebagai Blob, jadi `toDataURL`/encode gambar
 * besar tidak lagi membekukan UI.
 */
import type { EnhanceParams } from "./enhance";

/** Permintaan proses satu foto full-res. `pixels` = RGBA w×h (ArrayBuffer,
 *  dikirim via transfer — buffer sisi pengirim ter-detach). */
export type EnhancePhotoWorkerRequest = {
  type: "process";
  id: number;
  pixels: ArrayBuffer;
  w: number;
  h: number;
  params: EnhanceParams;
};

/** EnhancePhotoWorkerRequest tanpa `id` (id diisi createWorkerClient). */
export type EnhancePhotoWorkerRequestNoId = Omit<
  EnhancePhotoWorkerRequest,
  "id"
>;

/** Balasan: Blob PNG hasil (encode `convertToBlob` juga berjalan di worker). */
export type EnhancePhotoWorkerResponse =
  | { type: "process"; id: number; ok: true; blob: Blob }
  | { type: "process"; id: number; ok: false; error: string };
