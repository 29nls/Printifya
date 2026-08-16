/**
 * Kontrak pesan worker Background Removal (bgRemove.worker.ts). Types-only —
 * impor dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Worker MEMILIKI `ImageBitmap` hasil transparan + mask (dikirim via
 * `createImageBitmap` — terukur ~0 ms blokir pada 12MP — lalu transfer
 * zero-copy) sehingga komposit warna dan encode PNG (OffscreenCanvas
 * `convertToBlob`) berjalan di luar thread utama — klik ganti latar tidak
 * lagi membekukan UI (toDataURL full-res di thread utama terukur 300 ms–1,2
 * dtk pada foto 12MP).
 */
export type BgWorkerRequest =
  | {
      type: "setResult";
      id: number;
      /** Bitmap hasil transparan (pemilikannya pindah ke worker). */
      result: ImageBitmap;
      /** Bitmap mask grayscale resolusi penuh (pemilikannya pindah ke worker). */
      mask: ImageBitmap;
      /** Warna latar awal (null = transparan). */
      hex: string | null;
    }
  | { type: "recolor"; id: number; hex: string | null }
  | { type: "mask"; id: number };

/** BgWorkerRequest tanpa `id` (id diisi createWorkerClient). */
export type BgWorkerRequestNoId =
  | Omit<Extract<BgWorkerRequest, { type: "setResult" }>, "id">
  | Omit<Extract<BgWorkerRequest, { type: "recolor" }>, "id">
  | Omit<Extract<BgWorkerRequest, { type: "mask" }>, "id">;

export type BgWorkerResponse =
  | { type: "setResult"; id: number; ok: true; blob: Blob }
  | { type: "setResult"; id: number; ok: false; error: string }
  | { type: "recolor"; id: number; ok: true; blob: Blob }
  | { type: "recolor"; id: number; ok: false; error: string }
  | { type: "mask"; id: number; ok: true; blob: Blob }
  | { type: "mask"; id: number; ok: false; error: string };
