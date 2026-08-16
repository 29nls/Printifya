/**
 * Worker pipeline per-frame Video Face Enhance: menjalankan deteksi wajah +
 * `enhancePixels` + `temporalBlend` (via `processFramePixels` — sumber tunggal
 * yang sama dengan fallback thread utama) pada Web Worker, sehingga pemrosesan
 * video panjang tidak membekukan UI.
 *
 * Kontrak: piksel RGBA frame masuk sebagai ArrayBuffer (transfer, tanpa salin),
 * hasil keluar sebagai ArrayBuffer (transfer). Koherensi temporal `prev`
 * disimpan di dalam worker (buffer hasil di-transfer keluar, jadi disalin dulu
 * sebelum dikirim); pesan "reset" mengosongkannya (tiap awal run).
 */
import type { FaceWorkerRequest, FaceWorkerResponse } from "./faceWorkerApi";
import { processFramePixels } from "./videoEnhance";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<FaceWorkerRequest>) => void) | null;
  postMessage: (msg: FaceWorkerResponse, transfer?: Transferable[]) => void;
};

/** Frame hasil sebelumnya (koherensi temporal). Disalin sebelum transfer. */
let prev: Uint8ClampedArray | null = null;

ctx.onmessage = (e) => {
  const msg = e.data;

  if (msg.type === "reset") {
    prev = null;
    ctx.postMessage({ type: "reset", id: msg.id, ok: true });
    return;
  }

  const { id, pixels, w, h, params, temporal } = msg;
  try {
    const data = new Uint8ClampedArray(pixels);
    const { out, faceDetected } = processFramePixels(
      data,
      w,
      h,
      params,
      temporal,
      prev
    );
    // Simpan salinan sebagai prev untuk frame berikutnya — `out.buffer`
    // di-transfer keluar (ter-detach dari worker).
    prev = new Uint8ClampedArray(out);
    // out.buffer selalu ArrayBuffer (dibuat enhancePixels) — tipe TS dilebarkan
    // ke ArrayBufferLike karena bisa SharedArrayBuffer; cast aman.
    const buffer = out.buffer as ArrayBuffer;
    ctx.postMessage(
      {
        type: "processFrame",
        id,
        ok: true,
        pixels: buffer,
        faceDetected,
      },
      [buffer]
    );
  } catch (err) {
    ctx.postMessage({
      type: "processFrame",
      id,
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memproses frame.",
    });
  }
};
