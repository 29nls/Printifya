import { jsPDF } from "jspdf";
import type { PasFotoSize } from "./pasFotoSize";

export interface PdfSheetOptions {
  cols: number;
  rows: number;
  marginCm: number;
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
 */
async function buildSheetDoc(
  size: PasFotoSize,
  dataUrl: string,
  { cols, rows, marginCm }: PdfSheetOptions,
  autoPrint: boolean
): Promise<jsPDF> {
  if (!fitsA4(size, cols, rows, marginCm)) {
    throw new Error(
      `Grid ${cols}×${rows} tidak muat di A4 dengan margin ${marginCm} cm`
    );
  }

  const jpeg = await toJpegOnWhite(dataUrl);
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const gridW = size.widthMm * cols;
  const gridH = size.heightMm * rows;
  const marginX = Math.max(marginCm * 10, (PAGE_W_MM - gridW) / 2);
  const marginY = Math.max(marginCm * 10, (PAGE_H_MM - gridH) / 2);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      doc.addImage(
        jpeg,
        "JPEG",
        marginX + c * size.widthMm,
        marginY + r * size.heightMm,
        size.widthMm,
        size.heightMm
      );
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
