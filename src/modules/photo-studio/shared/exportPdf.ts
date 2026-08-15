import { jsPDF } from "jspdf";
import type { PasFotoSize } from "./pasFotoSize";

export interface PdfSheetOptions {
  cols: number;
  rows: number;
  marginCm: number;
  /** Label per foto (indeks sejajar dengan dataUrls); digambar di dasar tiap sel. */
  labels?: string[];
  /** Ukuran font label dalam pt. */
  labelSizePt?: number;
}

const PAGE_W_MM = 210; // A4
const PAGE_H_MM = 297; // A4
const MIN_MARGIN_CM = 0.2;

/** Cek apakah grid foto muat dalam halaman A4 dengan margin tertentu. */
export function fitsA4(
  size: PasFotoSize,
  cols: number,
  rows: number,
  marginCm: number
): boolean {
  return (
    size.widthMm * cols + 2 * marginCm * 10 <= PAGE_W_MM &&
    size.heightMm * rows + 2 * marginCm * 10 <= PAGE_H_MM
  );
}

/**
 * Jumlah kolom maksimal yang muat di A4 dengan margin tertentu
 * (default: margin minimal).
 */
export function maxCols(size: PasFotoSize, marginCm: number = MIN_MARGIN_CM): number {
  let c = 1;
  while (fitsA4(size, c + 1, 1, marginCm)) c += 1;
  return c;
}

/**
 * Jumlah baris maksimal yang muat di A4 dengan margin tertentu
 * (default: margin minimal).
 */
export function maxRows(size: PasFotoSize, marginCm: number = MIN_MARGIN_CM): number {
  let r = 1;
  while (fitsA4(size, 1, r + 1, marginCm)) r += 1;
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
  { cols, rows, marginCm, labels, labelSizePt }: PdfSheetOptions,
  autoPrint: boolean
): Promise<jsPDF> {
  if (!fitsA4(size, cols, rows, marginCm)) {
    throw new Error(
      `Grid ${cols}×${rows} tidak muat di A4 dengan margin ${marginCm} cm`
    );
  }

  const urls = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const jpegs = await Promise.all(urls.map(toJpegOnWhite));
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const gridW = size.widthMm * cols;
  const gridH = size.heightMm * rows;
  const marginX = Math.max(marginCm * 10, (PAGE_W_MM - gridW) / 2);
  const marginY = Math.max(marginCm * 10, (PAGE_H_MM - gridH) / 2);

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
  doc.save(`${size.fileName}-a4.pdf`);
}

/** Ekspor PDF layout: banyak foto disusun sel per sel, multi-halaman bila perlu. */
export async function exportLayoutPdf(
  size: PasFotoSize,
  srcs: string[],
  options: PdfSheetOptions
): Promise<void> {
  const doc = await buildSheetDoc(size, srcs, options, false);
  doc.save(`${size.fileName}-layout-a4.pdf`);
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
