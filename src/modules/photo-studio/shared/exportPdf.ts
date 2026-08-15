import { jsPDF } from "jspdf";
import type { PasFotoSize } from "./pasFotoSize";
import { getPaper, PAPER_A4, type PaperSize } from "./paperSize";

export interface PdfSheetOptions {
  cols: number;
  rows: number;
  marginCm: number;
  /** Ukuran kertas halaman; default A4. */
  paper?: PaperSize;
  /** Orientasi lembar; default potret (otomatis lanskap bila grid lebih muat melintang). */
  orientation?: SheetOrientation;
  /** Label per foto (indeks sejajar dengan dataUrls); digambar di dasar tiap sel. */
  labels?: string[];
  /** Ukuran font label dalam pt. */
  labelSizePt?: number;
  /** Garis potong putus-putus antar sel (mudah dipotong setelah cetak). */
  cutLines?: boolean;
}

export const MIN_MARGIN_CM = 0.2;

export type SheetOrientation = "portrait" | "landscape";

/** Dimensi efektif kertas sesuai orientasi (lanskap = diputar 90°). */
export function orientedDims(
  paper: PaperSize,
  orientation: SheetOrientation = "portrait"
): { widthMm: number; heightMm: number } {
  return orientation === "landscape"
    ? { widthMm: paper.heightMm, heightMm: paper.widthMm }
    : { widthMm: paper.widthMm, heightMm: paper.heightMm };
}

/**
 * Orientasi terbaik untuk grid tertentu: potret selama muat; otomatis lanskap
 * bila grid hanya muat bila lembar diputar melintang.
 */
export function chooseOrientation(
  size: PasFotoSize,
  cols: number,
  rows: number,
  marginCm: number,
  paper: PaperSize = PAPER_A4
): SheetOrientation {
  return fitsA4(size, cols, rows, marginCm, paper, "portrait")
    ? "portrait"
    : "landscape";
}

/** Cek apakah grid foto muat dalam halaman (default A4) dengan margin & orientasi tertentu. */
export function fitsA4(
  size: PasFotoSize,
  cols: number,
  rows: number,
  marginCm: number,
  paper: PaperSize = PAPER_A4,
  orientation: SheetOrientation = "portrait"
): boolean {
  const d = orientedDims(paper, orientation);
  return (
    size.widthMm * cols + 2 * marginCm * 10 <= d.widthMm &&
    size.heightMm * rows + 2 * marginCm * 10 <= d.heightMm
  );
}

/**
 * Jumlah kolom maksimal yang muat di halaman (default A4) dengan margin
 * & orientasi tertentu (default: margin minimal, potret).
 */
export function maxCols(
  size: PasFotoSize,
  marginCm: number = MIN_MARGIN_CM,
  paper: PaperSize = PAPER_A4,
  orientation: SheetOrientation = "portrait"
): number {
  let c = 1;
  while (fitsA4(size, c + 1, 1, marginCm, paper, orientation)) c += 1;
  return c;
}

/**
 * Jumlah baris maksimal yang muat di halaman (default A4) dengan margin
 * & orientasi tertentu (default: margin minimal, potret).
 */
export function maxRows(
  size: PasFotoSize,
  marginCm: number = MIN_MARGIN_CM,
  paper: PaperSize = PAPER_A4,
  orientation: SheetOrientation = "portrait"
): number {
  let r = 1;
  while (fitsA4(size, 1, r + 1, marginCm, paper, orientation)) r += 1;
  return r;
}

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
 * Bangun dokumen PDF A4 berisi grid pas foto pada ukuran fisik presisi (mm),
 * margin sesuai pengaturan, dan grid diratakan di tengah halaman.
 *
 * `dataUrls` bisa berupa satu gambar (diulang di semua sel — pola pas foto)
 * atau daftar gambar yang diisi sel per sel; bila lebih banyak dari jumlah
 * sel, dibuat halaman tambahan secara otomatis (Auto Layout).
 */
async function buildSheetDoc(
  size: PasFotoSize,
  dataUrls: string | string[],
  {
    cols,
    rows,
    marginCm,
    paper,
    orientation,
    labels,
    labelSizePt,
    cutLines,
  }: PdfSheetOptions,
  autoPrint: boolean
): Promise<jsPDF> {
  const p = getPaper(paper?.id);
  const orient = orientation ?? "portrait";
  const d = orientedDims(p, orient);
  if (!fitsA4(size, cols, rows, marginCm, p, orient)) {
    throw new Error(
      `Grid ${cols}×${rows} tidak muat di ${p.name} (${orient}) dengan margin ${marginCm} cm`
    );
  }

  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const jpegs = await Promise.all(urls.map(toJpegOnWhite));
  // jsPDF v4 menormalkan format [w,h] ke potret; orientasi lanskap harus
  // dinyatakan eksplisit agar halaman benar-benar diputar melintang.
  const doc = new jsPDF({
    unit: "mm",
    format: [d.widthMm, d.heightMm],
    orientation: orient === "landscape" ? "landscape" : "portrait",
  });

  const gridW = size.widthMm * cols;
  const gridH = size.heightMm * rows;
  const marginX = Math.max(marginCm * 10, (d.widthMm - gridW) / 2);
  const marginY = Math.max(marginCm * 10, (d.heightMm - gridH) / 2);

  const count = cols * rows;
  const pages = Math.max(1, Math.ceil(jpegs.length / count));
  const labelSize = labelSizePt ?? 7;

  for (let page = 0; page < pages; page++) {
    if (page > 0) doc.addPage();
    for (let i = 0; i < count; i++) {
      const idx = page * count + i;
      if (idx >= jpegs.length) break; // halaman terakhir boleh tidak penuh
      const x = marginX + (i % cols) * size.widthMm;
      const y = marginY + Math.floor(i / cols) * size.heightMm;
      doc.addImage(jpegs[idx], "JPEG", x, y, size.widthMm, size.heightMm);

      const label = labels?.[idx];
      if (label) {
        const barH = labelSize * 0.55 + 1; // mm
        const barY = y + size.heightMm - barH;
        doc.setFillColor(0, 0, 0);
        doc.rect(x, barY, size.widthMm, barH, "F");
        doc.setFontSize(labelSize);
        doc.setTextColor(255, 255, 255);
        const line = doc.splitTextToSize(label, size.widthMm - 2)[0] ?? "";
        doc.text(line, x + size.widthMm / 2, barY + barH - 0.8, {
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
        const x = marginX + c * size.widthMm;
        doc.line(x, marginY, x, marginY + gridH);
      }
      for (let r = 1; r < rows; r++) {
        const y = marginY + r * size.heightMm;
        doc.line(marginX, y, marginX + gridW, y);
      }
      doc.restoreGraphicsState();
    }
  }

  if (autoPrint) doc.autoPrint();
  return doc;
}

/** Ekspor PDF sebagai file yang diunduh. */
export async function exportPasFotoPdf(
  size: PasFotoSize,
  dataUrl: string,
  options: PdfSheetOptions
): Promise<void> {
  const doc = await buildSheetDoc(size, dataUrl, options, false);
  const paperId = getPaper(options.paper?.id).id;
  doc.save(`${size.fileName}-${paperId}.pdf`);
}

/** Ekspor PDF layout: banyak foto disusun sel per sel, multi-halaman bila perlu. */
export async function exportLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions
): Promise<void> {
  const doc = await buildSheetDoc(size, srcs, options, false);
  const paperId = getPaper(options.paper?.id).id;
  doc.save(`${size.fileName}-layout-${paperId}.pdf`);
}

/**
 * Buka PDF template di tab baru dan memicu dialog cetak browser (autoPrint).
 * Mengembalikan `false` jika pop-up diblokir.
 */
export async function printPasFotoPdf(
  size: PasFotoSize,
  dataUrl: string,
  options: PdfSheetOptions
): Promise<boolean> {
  const doc = await buildSheetDoc(size, dataUrl, options, true);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  // Biarkan viewer sempat memuat PDF sebelum URL di-revoke.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return win !== null;
}

/**
 * Buka PDF layout (banyak orang) di tab baru dan memicu dialog cetak browser.
 * Mengembalikan `false` jika pop-up diblokir.
 */
export async function printLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions
): Promise<boolean> {
  const doc = await buildSheetDoc(size, srcs, options, true);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  // Biarkan viewer sempat memuat PDF sebelum URL di-revoke.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return win !== null;
}
