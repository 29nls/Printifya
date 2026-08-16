/**
 * Kontrak pesan worker ekspor PDF (exportPdf.worker.ts). Types-only — impor
 * dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Worker menerima data URL ber-bingkai (kecil, 354×472 PNG) + opsi tata letak,
 * lalu SEMUA kerja terjadi di worker: konversi JPEG di atas putih
 * (fetch → Blob → createImageBitmap → OffscreenCanvas → convertToBlob),
 * perakitan jsPDF (`assembleSheet` — sumber yang sama dengan jalur thread
 * utama, jadi tata letak identik), dan `doc.output("blob")`. Thread utama hanya
 * fetch data URL kecil + post + menerima Blob hasil (transfer zero-copy).
 * `autoPrint` ikut di-worker (jsPDF murni) agar jalur cetak juga tidak
 * membekukan UI. Fallback thread utama bila tanpa Worker.
 */
import type { PasFotoSize } from "./pasFotoSize";
import type { PaperSize } from "./paperSize";
import type { SheetOrientation } from "./sheetLayout";

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

export type PdfWorkerRequest = {
  type: "build";
  id: number;
  size: PasFotoSize;
  dataUrls: string[];
  options: PdfSheetOptions;
  autoPrint: boolean;
};

/** PdfWorkerRequest tanpa `id` (id diisi createWorkerClient). */
export type PdfWorkerRequestNoId = Omit<PdfWorkerRequest, "id">;

export type PdfWorkerResponse =
  | { type: "build"; id: number; ok: true; blob: Blob }
  | { type: "build"; id: number; ok: false; error: string };
