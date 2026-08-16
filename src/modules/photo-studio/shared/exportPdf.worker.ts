/**
 * Worker ekspor PDF — SEMUA kerja gambar & dokumen di luar thread utama:
 * konversi JPEG di atas putih (fetch → Blob → createImageBitmap →
 * OffscreenCanvas → convertToBlob), perakitan jsPDF via `assembleSheet`
 * (sumber yang sama dengan jalur thread utama — tata letak identik), dan
 * `doc.output("blob")`. jsPDF murni JS (tanpa DOM untuk perakitan/output);
 * `save()` (yang memakai DOM) TIDAK dipanggil di worker — unduhan dilakukan
 * thread utama via downloadUrl. `autoPrint` ikut di-worker (murni).
 */
import { jsPDF } from "jspdf";
import { assembleSheet } from "./exportPdf";
import { getPaper } from "./paperSize";
import { fitsA4, orientedDims } from "./sheetLayout";
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from "./exportPdfWorkerApi";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<PdfWorkerRequest>) => void) | null;
  postMessage: (msg: PdfWorkerResponse, transfer?: Transferable[]) => void;
};

/** Padanan `toJpegOnWhite` jalur thread utama tanpa DOM: fetch data URL →
 *  Blob → createImageBitmap → OffscreenCanvas putih → JPEG. */
async function toJpegOnWhiteWorker(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d");
    if (!g) throw new Error("OffscreenCanvas 2D tidak tersedia.");
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0);
    const jpeg = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
    // FileReader di WORKER (thread utama tidak tersentuh).
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () =>
        reject(fr.error ?? new Error("Gagal encode JPEG di worker."));
      fr.readAsDataURL(jpeg);
    });
  } finally {
    bmp.close();
  }
}

ctx.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type !== "build") return;
    const { size, dataUrls, options, autoPrint } = msg;
    // Validasi grid terjadi di worker juga — error yang sama dengan jalur lama.
    const p = getPaper(options.paper?.id);
    const orient = options.orientation ?? "portrait";
    const d = orientedDims(p, orient);
    if (!fitsA4(size, options.cols, options.rows, options.marginCm, p, orient)) {
      throw new Error(
        `Grid ${options.cols}×${options.rows} tidak muat di ${p.name} (${orient}) dengan margin ${options.marginCm} cm`
      );
    }
    const jpegs = await Promise.all(dataUrls.map(toJpegOnWhiteWorker));
    const doc = new jsPDF({
      unit: "mm",
      format: [d.widthMm, d.heightMm],
      orientation: orient === "landscape" ? "landscape" : "portrait",
    });
    assembleSheet(doc, jpegs, size, options);
    if (autoPrint) doc.autoPrint();
    const blob = doc.output("blob");
    ctx.postMessage({ type: "build", id: msg.id, ok: true, blob }, [blob]);
  } catch (err) {
    ctx.postMessage({
      type: "build",
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : "Gagal membangun PDF di worker.",
    });
  }
};
