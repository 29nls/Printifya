import { jsPDF } from "jspdf";
import {
  createWorkerClient,
  type WorkerClient,
} from "../../shared/createWorkerClient";
import { downloadUrl } from "../../shared/downloadUrl";
import { sharePdf, type ShareOptions } from "../../shared/nativeShare";
import type { PasFotoSize } from "./pasFotoSize";
import { getPaper } from "./paperSize";
import {
  computeSheetLayout,
  fitsA4,
  orientedDims,
  sheetCellRect,
  sheetLabelBarMm,
  sheetPageCount,
} from "./sheetLayout";
import type {
  PdfWorkerRequestNoId,
  PdfWorkerResponse,
} from "./exportPdfWorkerApi";

// Matematika tata letak lembar kini tinggal di sheetLayout.ts (tanpa jsPDF);
// re-ekspor ini menjaga pemakai lama tetap berfungsi tanpa perubahan.
export {
  MIN_MARGIN_CM,
  chooseOrientation,
  fitsA4,
  maxCols,
  maxRows,
  orientedDims,
  type SheetOrientation,
} from "./sheetLayout";

/** Opsi lembar PDF — kontrak bersama thread utama & worker (types-only file
 *  exportPdfWorkerApi.ts; re-ekspor menjaga pemakai lama). */
export type { PdfSheetOptions } from "./exportPdfWorkerApi";
import type { PdfSheetOptions } from "./exportPdfWorkerApi";

/** Komposit gambar di atas latar putih lalu encode JPEG agar PDF lebih ringkas. */
function toJpegOnWhite(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D tidak tersedia"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("Gagal memuat gambar hasil crop"));
    img.src = dataUrl;
  });
}

/**
 * Perakitan isi dokumen PDF (grid sel, label, garis potong, multi-halaman) —
 * MURNI (jsPDF + sheetLayout, tanpa DOM): SUMBER TUNGGAL tata letak untuk
 * jalur thread utama (`buildSheetDoc`) DAN Web Worker (`exportPdf.worker.ts`),
 * sehingga kedua jalur menghasilkan dokumen yang setara. `jpegs` = data URL
 * JPEG di atas putih, `size`/`options` = preset & pengaturan lembar.
 */
export function assembleSheet(
  doc: jsPDF,
  jpegs: string[],
  size: PasFotoSize,
  {
    cols,
    rows,
    marginCm,
    paper,
    orientation,
    labels,
    labelSizePt,
    cutLines,
  }: PdfSheetOptions
): void {
  const p = getPaper(paper?.id);
  const orient = orientation ?? "portrait";
  if (!fitsA4(size, cols, rows, marginCm, p, orient)) {
    throw new Error(
      `Grid ${cols}×${rows} tidak muat di ${p.name} (${orient}) dengan margin ${marginCm} cm`
    );
  }

  const layout = computeSheetLayout(size, cols, rows, marginCm, p, orient);
  const pages = sheetPageCount(jpegs.length, layout.count);
  const labelSize = labelSizePt ?? 7;

  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.addPage();
    for (let i = 0; i < layout.count; i++) {
      const idx = page * layout.count + i;
      if (idx >= jpegs.length) break; // halaman terakhir boleh tidak penuh
      // Posisi & ukuran sel absolut dari sumber tunggal (sheetLayout).
      const cell = sheetCellRect(i, cols, size.widthMm, size.heightMm, layout);
      doc.addImage(jpegs[idx], "JPEG", cell.x, cell.y, cell.w, cell.h);

      const label = labels?.[idx];
      if (label) {
        // Area label di dasar sel (mm) — hitungan bersama pratinjau/cetak.
        const bar = sheetLabelBarMm(cell.h, labelSize);
        const barY = cell.y + bar.y;
        doc.setFillColor(0, 0, 0);
        doc.rect(cell.x, barY, cell.w, bar.h, "F");
        doc.setFontSize(labelSize);
        doc.setTextColor(255, 255, 255);
        const line = doc.splitTextToSize(label, cell.w - 2)[0] ?? "";
        doc.text(line, cell.x + cell.w / 2, barY + bar.h - 0.8, {
          align: "center",
        });
      }
    }

    // Garis potong putus-putus antar sel (sekat) — mudah dipotong setelah cetak.
    if (cutLines) {
      doc.saveGraphicsState();
      doc.setLineWidth(0.2);
      doc.setDrawColor(150, 150, 150);
      doc.setLineDashPattern([0.8, 0.7], 0);
      for (let c = 1; c < cols; c++) {
        const x = sheetCellRect(c, cols, size.widthMm, size.heightMm, layout).x;
        doc.line(x, layout.marginY, x, layout.marginY + layout.gridH);
      }
      for (let r = 1; r < rows; r++) {
        const y = sheetCellRect(r * cols, cols, size.widthMm, size.heightMm, layout).y;
        doc.line(layout.marginX, y, layout.marginX + layout.gridW, y);
      }
      doc.restoreGraphicsState();
    }
  }
}

/**
 * Bangun dokumen PDF berisi grid pas foto pada ukuran fisik presisi (mm),
 * margin sesuai pengaturan, dan grid diratakan di tengah halaman — tata
 * letak dihitung oleh sheetLayout.ts / assembleSheet, sama persis dengan
 * pratinjau & cetak. Jalur THREAD UTAMA (fallback): dipakai bila tidak ada
 * Worker; hasil dokumen setara dengan jalur worker (perakitan bersama).
 *
 * `dataUrls` bisa berupa satu gambar (diulang di semua sel — pola pas foto)
 * atau daftar gambar yang diisi sel per sel; bila lebih banyak dari jumlah
 * sel, dibuat halaman tambahan secara otomatis (Auto Layout).
 */
async function buildSheetDoc(
  size: PasFotoSize,
  dataUrls: string | string[],
  options: PdfSheetOptions,
  autoPrint: boolean
): Promise<jsPDF> {
  const p = getPaper(options.paper?.id);
  const orient = options.orientation ?? "portrait";
  const d = orientedDims(p, orient);
  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const jpegs = await Promise.all(urls.map(toJpegOnWhite));
  // jsPDF v4 menormalkan format [w,h] ke potret; orientasi lanskap harus
  // dinyatakan eksplisit agar halaman benar-benar diputar melintang.
  const doc = new jsPDF({
    unit: "mm",
    format: [d.widthMm, d.heightMm],
    orientation: orient === "landscape" ? "landscape" : "portrait",
  });
  assembleSheet(doc, jpegs, size, options);
  if (autoPrint) doc.autoPrint();
  return doc;
}

// --- Jalur Web Worker (pola createWorkerClient) ---
// Perakitan PDF (konversi JPEG + jsPDF) berjalan di worker agar UI tidak
// membeku pada lembar besar (terukur: ~286 ms/1 halaman, ~689 ms/2 halaman,
// skala ~340 ms/halaman — membeku detik-detik pada grid besar seperti 30R).
// Worker dibuat lazy sekali; bila gagal/tanpa Worker → fallback thread utama
// (buildSheetDoc) dengan hasil setara (assembleSheet sumber bersama).

type PdfWorkerClient = WorkerClient<PdfWorkerRequestNoId, PdfWorkerResponse>;

let pdfWorkerClient: PdfWorkerClient | null = null;

function getPdfWorkerClient(): PdfWorkerClient | null {
  if (typeof Worker === "undefined" || typeof createImageBitmap !== "function") {
    return null;
  }
  if (!pdfWorkerClient) {
    pdfWorkerClient = createWorkerClient<PdfWorkerRequestNoId, PdfWorkerResponse>({
      createWorker: () =>
        new Worker(new URL("./exportPdf.worker.ts", import.meta.url), {
          type: "module",
        }),
      errorMessage: "Worker PDF gagal.",
    });
  }
  return pdfWorkerClient;
}

/**
 * Bangun blob PDF — lewat Web Worker bila tersedia, fallback thread utama.
 * `dataUrls` data URL ber-bingkai (kecil); worker melakukan konversi JPEG +
 * perakitan + output blob (transfer zero-copy).
 */
export async function buildSheetBlob(
  size: PasFotoSize,
  dataUrls: string | string[],
  options: PdfSheetOptions,
  autoPrint: boolean
): Promise<Blob> {
  const client = getPdfWorkerClient();
  if (client) {
    try {
      const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
      const res = await client.post({
        type: "build",
        size,
        dataUrls: urls,
        options,
        autoPrint,
      });
      if (!res.ok) throw new Error(res.error);
      return res.blob;
    } catch {
      // Worker gagal (mis. tanpa createImageBitmap di worker) → jalur lama.
    }
  }
  const doc = await buildSheetDoc(size, dataUrls, options, autoPrint);
  return doc.output("blob");
}

/** Unduh blob sebagai file via downloadUrl (shared; revoke blob URL terpusat). */
function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
}

/** Ekspor PDF sebagai file yang diunduh. */
export async function exportPasFotoPdf(
  size: PasFotoSize,
  dataUrl: string,
  options: PdfSheetOptions
): Promise<void> {
  const blob = await buildSheetBlob(size, dataUrl, options, false);
  const paperId = getPaper(options.paper?.id).id;
  downloadBlob(blob, `${size.fileName}-${paperId}.pdf`);
}

/** Ekspor PDF layout: banyak foto disusun sel per sel, multi-halaman bila perlu. */
export async function exportLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions
): Promise<void> {
  const blob = await buildSheetBlob(size, srcs, options, false);
  const paperId = getPaper(options.paper?.id).id;
  downloadBlob(blob, `${size.fileName}-layout-${paperId}.pdf`);
}

/** Buka PDF template di tab baru (autoPrint sudah di-set — di worker bila ada). */
async function openPrintPdf(
  size: PasFotoSize,
  dataUrls: string | string[],
  options: PdfSheetOptions
): Promise<boolean> {
  const blob = await buildSheetBlob(size, dataUrls, options, true);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  // Biarkan viewer sempat memuat PDF sebelum URL di-revoke.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return win !== null;
}

/**
 * Buka PDF template di tab baru dan memicu dialog cetak browser (autoPrint).
 * Mengembalikan `false` jika pop-up diblokir.
 */
export function printPasFotoPdf(
  size: PasFotoSize,
  dataUrl: string,
  options: PdfSheetOptions
): Promise<boolean> {
  return openPrintPdf(size, dataUrl, options);
}

/**
 * Buka PDF layout (banyak orang) di tab baru dan memicu dialog cetak browser.
 * Mengembalikan `false` jika pop-up diblokir.
 */
export function printLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions
): Promise<boolean> {
  return openPrintPdf(size, srcs, options);
}

// --- Native Share ---

/** Bagikan PDF pas foto via native share sheet (Android) atau Web Share API. */
export async function sharePasFotoPdf(
  size: PasFotoSize,
  dataUrl: string,
  options: PdfSheetOptions,
  shareOptions?: ShareOptions
): Promise<boolean> {
  const blob = await buildSheetBlob(size, dataUrl, options, false);
  const paperId = getPaper(options.paper?.id).id;
  const filename = `${size.fileName}-${paperId}.pdf`;
  return sharePdf(blob, filename, {
    title: `Pas Foto ${size.label}`,
    text: `Pas foto ${size.label} dari Printifya`,
    ...shareOptions,
  });
}

/** Bagikan PDF layout via native share sheet. */
export async function shareLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions,
  shareOptions?: ShareOptions
): Promise<boolean> {
  const blob = await buildSheetBlob(size, srcs, options, false);
  const paperId = getPaper(options.paper?.id).id;
  const filename = `${size.fileName}-layout-${paperId}.pdf`;
  return sharePdf(blob, filename, {
    title: `Layout ${size.label}`,
    text: `Layout pas foto ${size.label} dari Printifya`,
    ...shareOptions,
  });
}
