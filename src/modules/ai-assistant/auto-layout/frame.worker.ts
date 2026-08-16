/**
 * Worker framing Auto Layout — SEMUA kerja gambar (decode, cover-fit,
 * bingkai photobox, encode PNG, base64) di luar thread utama. Menerima
 * `Blob` sumber (diklon dari fetch — lebih kecil daripada bitmap RGBA),
 * decode via `createImageBitmap`, gambar object-fit:cover via `coverFitRect`
 * (sumber tunggal yang sama dengan `applyFrame` thread utama), panggil
 * `frame.draw` dari katalog frames.ts (semua primitif 2D — fillRect/arc/
 * arcTo/createPattern/fillText — didukung OffscreenCanvas), encode PNG
 * `convertToBlob`, lalu FileReader → data URL string. Hasil piksel identik
 * dengan jalur lama; hanya lokasi eksekusinya berbeda.
 */
import {
  coverFitRect,
  getFrame,
} from "../../photo-studio/shared/frames";
import type {
  FrameWorkerRequest,
  FrameWorkerResponse,
} from "./frameWorkerApi";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<FrameWorkerRequest>) => void) | null;
  postMessage: (msg: FrameWorkerResponse) => void;
};

ctx.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type !== "frame") return;
    const frame = getFrame(msg.frameId);
    if (!frame) throw new Error(`Bingkai tidak dikenal: ${msg.frameId}`);
    const bmp = await createImageBitmap(msg.blob);
    const out = new OffscreenCanvas(
      Math.max(1, Math.round(msg.width)),
      Math.max(1, Math.round(msg.height))
    );
    const o = out.getContext("2d");
    if (!o) throw new Error("OffscreenCanvas 2D tidak tersedia.");
    const { dx, dy, dw, dh } = coverFitRect(
      bmp.width,
      bmp.height,
      out.width,
      out.height
    );
    o.drawImage(bmp, dx, dy, dw, dh);
    bmp.close();
    try {
      // Katalog frames.ts bertipe CanvasRenderingContext2D — metode yang
      // dipakai semua bingkai (fillRect/arc/arcTo/createPattern/fillText dll)
      // tersedia identik di OffscreenCanvasRenderingContext2D.
      frame.draw(o as unknown as CanvasRenderingContext2D, out.width, out.height, {
        hashtagText: msg.hashtagText,
        bannerText: msg.bannerText,
      });
    } catch {
      // bingkai gagal digambar — biarkan foto asli (sama dengan applyFrame)
    }
    const blob = await out.convertToBlob({ type: "image/png" });
    // FileReader (async) dijalankan DI WORKER — main thread tidak tersentuh;
    // FileReaderSync tidak ada di lib DOM.
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error ?? new Error("Gagal encode data URL."));
      fr.readAsDataURL(blob);
    });
    ctx.postMessage({ type: "frame", id: msg.id, ok: true, dataUrl });
  } catch (err) {
    ctx.postMessage({
      type: msg.type,
      id: msg.id,
      ok: false,
      error:
        err instanceof Error ? err.message : "Gagal mem-frame di worker.",
    });
  }
};
