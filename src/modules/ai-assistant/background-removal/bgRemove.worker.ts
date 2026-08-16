/**
 * Worker Background Removal — jalur PENYAJIAN hasil (komposit + encode PNG),
 * bukan segmentasi: thread utama mengirim `ImageBitmap` hasil transparan &
 * mask resolusi penuh (createImageBitmap ≈ 0 ms blokir untuk 12MP; transfer
 * zero-copy), worker menyimpannya dan melakukan komposit warna + encode PNG
 * (OffscreenCanvas `convertToBlob`) DI WORKER. toDataURL/toBlob full-res di
 * thread utama (terukur 300 ms–1,2 dtk pada foto 12MP) tidak pernah terjadi.
 *
 * Kontrak: "setResult" (terima bitmap, encode hasil awal), "recolor"
 * (komposit ulang dengan warna/transparan, kirim Blob PNG hasil), "mask"
 * (encode mask). Blob yang dikirim = HASIL (`resultUrl` jalur fallback):
 * transparan → piksel mentah (alpha dipertahankan, TANPA checkerboard);
 * warna polos → komposit warna (padanan `applyBackgroundColor`). Panel
 * banding dengan checkerboard dibangun di thread utama dari blob ini
 * (`buildShownCanvas`, pola fill O(1)) — encode full-res tidak pernah
 * menyentuh main thread.
 */
import type {
  BgWorkerRequest,
  BgWorkerResponse,
} from "./bgRemoveWorkerApi";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<BgWorkerRequest>) => void) | null;
  postMessage: (
    msg: BgWorkerResponse,
    transfer?: Transferable[]
  ) => void;
};

let resultBitmap: ImageBitmap | null = null;
let maskBitmap: ImageBitmap | null = null;

/** Blob HASIL (padanan `resultUrl` jalur fallback): transparan → piksel mentah
 *  (alpha dipertahankan, tanpa checkerboard); warna polos → komposit warna
 *  (isi `hex` lalu gambar hasil di atasnya — padanan `applyBackgroundColor`). */
async function encodeResult(hex: string | null): Promise<Blob> {
  if (!resultBitmap) throw new Error("Belum ada hasil di worker.");
  const out = new OffscreenCanvas(resultBitmap.width, resultBitmap.height);
  const o = out.getContext("2d");
  if (!o) throw new Error("OffscreenCanvas 2D tidak tersedia.");
  if (hex) {
    o.fillStyle = hex;
    o.fillRect(0, 0, out.width, out.height);
  }
  o.drawImage(resultBitmap, 0, 0);
  return out.convertToBlob({ type: "image/png" });
}

ctx.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === "setResult") {
      resultBitmap = msg.result;
      maskBitmap = msg.mask;
      const blob = await encodeResult(msg.hex);
      ctx.postMessage({ type: "setResult", id: msg.id, ok: true, blob });
      return;
    }
    if (msg.type === "recolor") {
      const blob = await encodeResult(msg.hex);
      ctx.postMessage({ type: "recolor", id: msg.id, ok: true, blob });
      return;
    }
    if (msg.type === "mask") {
      if (!maskBitmap) throw new Error("Belum ada mask di worker.");
      const out = new OffscreenCanvas(maskBitmap.width, maskBitmap.height);
      const o = out.getContext("2d");
      if (!o) throw new Error("OffscreenCanvas 2D tidak tersedia.");
      o.drawImage(maskBitmap, 0, 0);
      const blob = await out.convertToBlob({ type: "image/png" });
      ctx.postMessage({ type: "mask", id: msg.id, ok: true, blob });
      return;
    }
  } catch (err) {
    ctx.postMessage({
      type: msg.type,
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : "Gagal memproses di worker.",
    });
  }
};
