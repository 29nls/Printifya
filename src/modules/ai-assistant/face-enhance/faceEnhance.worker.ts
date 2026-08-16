/**
 * Worker pipeline full-res Face Enhance: menjalankan `applyFaceEnhance`
 * (restore wajah — sumber tunggal yang sama dengan jalur thread utama) +
 * `upscaleCanvas` (perbesaran 2×/4×, pola Real-ESRGAN) pada Web Worker,
 * sehingga Unduh PNG / Jadikan Pas Foto / Susun ke Lembar A4 pada foto besar
 * (≥2000 px, canvas hingga ~12000 px) tidak membekukan UI.
 *
 * Kontrak: piksel RGBA masuk sebagai ArrayBuffer (transfer, tanpa salin),
 * hasil keluar sebagai Blob PNG (encode `convertToBlob` juga di worker).
 * Kotak wajah dihitung di thread utama (`detectFace` — murah karena downscale
 * ≤240 px) dan dikirim sebagai data, jadi hasil identik dengan jalur
 * `enhanceFace` lama.
 */
import type {
  FaceEnhanceWorkerRequest,
  FaceEnhanceWorkerResponse,
} from "./faceEnhanceWorkerApi";
import { applyFaceEnhance } from "./faceEnhance";
import { setCanvasFactory, upscaleCanvas } from "../upscale-denoise/waifu2x";

// Perantara kanvas di worker memakai OffscreenCanvas (tidak ada document).
setCanvasFactory((w, h) => new OffscreenCanvas(w, h));

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<FaceEnhanceWorkerRequest>) => void) | null;
  postMessage: (
    msg: FaceEnhanceWorkerResponse,
    transfer?: Transferable[]
  ) => void;
};

ctx.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type !== "process") return;
  const { id, pixels, w, h, face, params, upscale } = msg;
  try {
    const data = new Uint8ClampedArray(pixels);
    // 1) Restore wajah (sumber tunggal yang sama dengan fallback thread utama).
    const out = applyFaceEnhance(data, w, h, face, params);
    // 2) Kanvas hasil pemulihan → perbesaran (CodeFormer → Real-ESRGAN).
    const canvas = new OffscreenCanvas(w, h);
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new Error("OffscreenCanvas 2D tidak tersedia.");
    // Salinan eksplisit agar buffer ber-backing ArrayBuffer (bukan
    // ArrayBufferLike) — kontrak ImageData di lib DOM modern.
    ctx2d.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
    const factor = Math.max(1, Math.round(upscale));
    const final = factor > 1 ? upscaleCanvas(canvas, factor) : canvas;
    // 3) Encode PNG DI WORKER (OffscreenCanvas.convertToBlob) — hasil keluar
    //    sebagai Blob, jadi `toDataURL`/encode gambar besar (hingga ~12000 px)
    //    tidak lagi membekukan UI. `final` selalu OffscreenCanvas (factory
    //    `createCanvas` di atas) — guard instanceof menegaskannya.
    if (!(final instanceof OffscreenCanvas)) {
      throw new Error("OffscreenCanvas tidak tersedia di worker.");
    }
    const blob = await final.convertToBlob({ type: "image/png" });
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
