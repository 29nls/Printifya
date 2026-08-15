/**
 * Worker pipeline Upscale & Denoise: menjalankan processImage (upscale →
 * denoise → TTA average) pada OffscreenCanvas sehingga batch tidak pernah
 * membekukan UI. Sumber dikirim sebagai ImageBitmap (transfer, tanpa salin);
 * hasil dikembalikan sebagai blob (URL tampilan/unduh) + ImageBitmap
 * (referensi perbandingan format) — semuanya tanpa kerja berat di main thread.
 */
import {
  canvasLikeToBlob,
  processImage,
  setCanvasFactory,
} from "./waifu2x";
import type { Waifu2xWorkerRequest, Waifu2xWorkerResponse } from "./waifu2xWorkerApi";

// Di worker tidak ada document.createElement — pipeline memakai OffscreenCanvas.
setCanvasFactory((w, h) => new OffscreenCanvas(w, h));

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Waifu2xWorkerRequest>) => void) | null;
  postMessage: (msg: Waifu2xWorkerResponse, transfer?: Transferable[]) => void;
};

ctx.onmessage = async (e) => {
  const { id, bitmap, options, format, quality } = e.data;
  try {
    const src = new OffscreenCanvas(bitmap.width, bitmap.height);
    src.getContext("2d")!.drawImage(bitmap, 0, 0);
    const out = processImage(src, options);
    const blob = await canvasLikeToBlob(out, format, quality);
    const resultBitmap = await createImageBitmap(out);
    ctx.postMessage(
      { id, ok: true, blob, width: out.width, height: out.height, bitmap: resultBitmap },
      [resultBitmap]
    );
  } catch (err) {
    ctx.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memproses gambar.",
    });
  }
};
