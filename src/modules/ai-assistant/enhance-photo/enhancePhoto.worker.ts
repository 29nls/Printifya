/**
 * Worker pipeline full-res Enhance Photo: menjalankan `enhancePixels` (inti
 * murni per-piksel — sumber tunggal yang sama dengan `enhanceImage` pratinjau
 * live) pada Web Worker, sehingga Unduh PNG / Susun ke Lembar A4 pada foto
 * besar (≥2000 px) tidak membekukan UI.
 *
 * Kontrak: piksel RGBA masuk sebagai ArrayBuffer (transfer, tanpa salin),
 * hasil keluar sebagai Blob PNG (encode `convertToBlob` juga di worker).
 * Ukuran hasil = ukuran penuh sumber (radius unsharp 4 — sama dengan jalur
 * `enhanceImage(img, params)` lama, di mana w = srcW).
 */
import type {
  EnhancePhotoWorkerRequest,
  EnhancePhotoWorkerResponse,
} from "./enhancePhotoWorkerApi";
import { enhancePixels } from "./enhance";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<EnhancePhotoWorkerRequest>) => void) | null;
  postMessage: (
    msg: EnhancePhotoWorkerResponse,
    transfer?: Transferable[]
  ) => void;
};

ctx.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "process") return;
  const { id, pixels, w, h, params } = msg;
  try {
    const data = new Uint8ClampedArray(pixels);
    // Pipeline murni (sumber tunggal yang sama dengan fallback thread utama).
    const out = enhancePixels(data, w, h, params);
    // Kanvas hasil → encode PNG DI WORKER (OffscreenCanvas.convertToBlob) —
    // encode gambar besar tidak lagi membekukan UI.
    const canvas = new OffscreenCanvas(w, h);
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new Error("OffscreenCanvas 2D tidak tersedia.");
    // Salinan eksplisit agar buffer ber-backing ArrayBuffer (bukan
    // ArrayBufferLike) — kontrak ImageData di lib DOM modern.
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    ctx.postMessage({ type: "process", id, ok: true, blob });
  } catch (err) {
    ctx.postMessage({
      type: "process",
      id,
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memproses foto.",
    });
  }
};
