/**
 * Kontrak pesan worker framing Auto Layout (frame.worker.ts). Types-only —
 * impor dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Worker MENERIMA `Blob` sumber (fetch main-thread — blob:/data: URL; klon
 * ~2 MB untuk JPEG, lebih kecil dari bitmap RGBA 24 MB) lalu SEMUA kerja
 * gambar terjadi di worker: `createImageBitmap(blob)` (decode), cover-fit +
 * `frame.draw` di OffscreenCanvas, `convertToBlob`, lalu FileReader → data
 * URL string. Thread utama hanya fetch + post + menerima string —
 * decode/draw/encode/base64 (terukur 38–64 ms per foto) tidak pernah
 * menyentuh main thread. Satu blob per permintaan, diproses berurutan per
 * worker — memori terjaga (bukan 30 bitmap full-res sekaligus).
 */
export type FrameWorkerRequest = {
  type: "frame";
  id: number;
  /** Id bingkai di katalog frames.ts (dicari worker via getFrame). */
  frameId: string;
  /** Dimensi kanvas hasil (size pas foto aktif, mis. 354×472). */
  width: number;
  height: number;
  /** Sumber foto asli (diklon ke worker; decode dilakukan di sana). */
  blob: Blob;
  /** Teks kustom untuk bingkai bertulisan Booth. */
  hashtagText: string;
  bannerText: string;
};

/** FrameWorkerRequest tanpa `id` (id diisi createWorkerClient). */
export type FrameWorkerRequestNoId = Omit<FrameWorkerRequest, "id">;

export type FrameWorkerResponse =
  | { type: "frame"; id: number; ok: true; dataUrl: string }
  | { type: "frame"; id: number; ok: false; error: string };
