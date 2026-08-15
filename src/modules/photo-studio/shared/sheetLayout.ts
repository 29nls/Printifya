import type { PasFotoSize } from "./pasFotoSize";
import { PAPER_A4, type PaperSize } from "./paperSize";

/**
 * Matematika tata letak lembar cetak (satuan mm) — sumber tunggal untuk
 * pratinjau (A4SheetPreview), ekspor PDF (exportPdf), dan cetak HTML
 * (printHtml). File ini murni komputasi, tanpa dependency jsPDF/canvas,
 * sehingga ketiga jalur memakai hitungan grid & margin yang identik.
 */

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

/** Cek apakah grid foto muat dalam halaman dengan margin & orientasi tertentu. */
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
 * Jumlah kolom maksimal yang muat di halaman dengan margin & orientasi
 * tertentu (default: margin minimal, potret).
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
 * Jumlah baris maksimal yang muat di halaman dengan margin & orientasi
 * tertentu (default: margin minimal, potret).
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

/** Hasil hitungan tata letak lembar dalam mm. */
export interface SheetLayout {
  /** Lebar total grid (cols × lebar foto), mm. */
  gridW: number;
  /** Tinggi total grid (rows × tinggi foto), mm. */
  gridH: number;
  /** Margin kiri/kanan, mm — maksimum(margin minta, sentris di lembar). */
  marginX: number;
  /** Margin atas/bawah, mm — maksimum(margin minta, sentris di lembar). */
  marginY: number;
  /** Jumlah sel per halaman (cols × rows). */
  count: number;
}

/**
 * Hitung tata letak grid pada lembar: ukuran grid serta margin yang
 * diratakan di tengah halaman (dijamin minimal `marginCm`). Dipakai sama
 * oleh pratinjau (skala px), PDF (jsPDF mm), dan cetak HTML (mm CSS).
 */
export function computeSheetLayout(
  size: PasFotoSize,
  cols: number,
  rows: number,
  marginCm: number,
  paper: PaperSize = PAPER_A4,
  orientation: SheetOrientation = "portrait"
): SheetLayout {
  const d = orientedDims(paper, orientation);
  const gridW = size.widthMm * cols;
  const gridH = size.heightMm * rows;
  const marginX = Math.max(marginCm * 10, (d.widthMm - gridW) / 2);
  const marginY = Math.max(marginCm * 10, (d.heightMm - gridH) / 2);
  return { gridW, gridH, marginX, marginY, count: cols * rows };
}

/**
 * Jumlah halaman yang diperlukan untuk `itemCount` foto dengan
 * `cellsPerPage` sel per halaman (minimal 1 halaman).
 */
export function sheetPageCount(itemCount: number, cellsPerPage: number): number {
  return Math.max(1, Math.ceil(itemCount / cellsPerPage));
}

/** Posisi pojok kiri-atas & ukuran sel ke-`i` pada lembar — satuan mengikuti
 *  layout (mm untuk tata letak asli, px untuk hasil `scaleSheetLayout`).
 *  Kiri-ke-kanan, atas-ke-bawah; `cellW`/`cellH` dalam satuan yang sama. */
export function sheetCellRect(
  i: number,
  cols: number,
  cellW: number,
  cellH: number,
  layout: SheetLayout
): { x: number; y: number; w: number; h: number } {
  return {
    x: layout.marginX + (i % cols) * cellW,
    y: layout.marginY + Math.floor(i / cols) * cellH,
    w: cellW,
    h: cellH,
  };
}

/** Skalakan seluruh layout dengan faktor (mis. mm → px pratinjau). `count`
 *  tidak berubah; hasilnya dipakai `sheetCellRect`/`sheetCellAtPoint` dalam px. */
export function scaleSheetLayout(layout: SheetLayout, factor: number): SheetLayout {
  return {
    gridW: layout.gridW * factor,
    gridH: layout.gridH * factor,
    marginX: layout.marginX * factor,
    marginY: layout.marginY * factor,
    count: layout.count,
  };
}

/** Indeks sel yang memuat titik absolut (x, y) — kiri-ke-kanan, atas-ke-bawah;
 *  -1 bila di luar area grid. Satuan (x, y, cellW, cellH, layout) harus sama
 *  (mm atau px). Logika drag/posisi memakai ini agar sumber posisi tunggal. */
export function sheetCellAtPoint(
  x: number,
  y: number,
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  layout: SheetLayout
): number {
  const gx = x - layout.marginX;
  const gy = y - layout.marginY;
  if (gx < 0 || gy < 0) return -1;
  const col = Math.floor(gx / cellW);
  const row = Math.floor(gy / cellH);
  if (col >= cols || row >= rows) return -1;
  return row * cols + col;
}

/** Area label di dasar sel (mm): tinggi batang dari ukuran font (pt) + padding
 *  tetap, menempel di dasar sel. Sumber tunggal hitungan area label untuk
 *  pratinjau/PDF/cetak (dipakai exportPdf untuk batang label). */
export function sheetLabelBarMm(
  cellH: number,
  labelSizePt: number
): { y: number; h: number } {
  const h = labelSizePt * 0.55 + 1; // mm
  return { y: cellH - h, h };
}
