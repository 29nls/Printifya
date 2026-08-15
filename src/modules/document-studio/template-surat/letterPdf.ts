import { jsPDF } from "jspdf";
import { formatTanggal, splitParagraf, type LetterData } from "./letterHtml";

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN_X = 22;
const MARGIN_TOP = 25;
const MARGIN_BOTTOM = 25;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

/** Muat dimensi logo (data URL) agar rasio aspeknya terjaga di PDF. */
function loadLogoDims(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Gagal memuat logo."));
    img.src = dataUrl;
  });
}

function fileName(data: LetterData): string {
  const slug = (data.perihal || "resmi")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `surat-${slug || "resmi"}.pdf`;
}

/**
 * Ekspor surat resmi sebagai file PDF dengan teks native (selectable) —
 * memakai jsPDF secara langsung, bukan screenshot html2canvas.
 */
export async function exportLetterPdf(data: LetterData): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const paragraf = splitParagraf(data.isi);

  let y = MARGIN_TOP;

  const ensure = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
  };

  // ---------- Kop surat ----------
  if (data.logo) {
    const { w: nw, h: nh } = await loadLogoDims(data.logo);
    const logoH = 16;
    const logoW = nh > 0 ? Math.min(40, (logoH * nw) / nh) : 16;
    ensure(logoH + 2);
    doc.addImage(data.logo, "PNG", (PAGE_W - logoW) / 2, y, logoW, logoH);
    y += logoH + 3;
  }

  ensure(16);
  doc.setFont("times", "bold");
  doc.setFontSize(16);
  doc.text(data.instansi || " ", PAGE_W / 2, y, { align: "center" });
  y += 7;

  doc.setFont("times", "normal");
  doc.setFontSize(9);
  const alamatLines = doc.splitTextToSize(data.alamat || " ", CONTENT_W);
  doc.text(alamatLines, PAGE_W / 2, y, { align: "center" });
  y += alamatLines.length * 4 + 2;

  // Garis kop ganda.
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 1.3;
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 7;

  // ---------- Nomor / Lampiran / Perihal / Kepada ----------
  const meta = [
    ["Nomor", data.nomor],
    ["Lampiran", data.lampiran],
    ["Perihal", data.perihal],
  ] as const;

  doc.setFontSize(11);
  for (const [label, value] of meta) {
    const lines = doc.splitTextToSize(value || " ", CONTENT_W - 30);
    ensure(lines.length * 5.5 + 2);
    doc.setFont("times", "bold");
    doc.text(label, MARGIN_X, y);
    doc.setFont("times", "normal");
    doc.text(lines, MARGIN_X + 30, y);
    y += lines.length * 5.5 + 1;
  }
  const kepadaLines = doc.splitTextToSize(data.kepada || " ", CONTENT_W - 30);
  ensure(kepadaLines.length * 5.5 + 2);
  doc.setFont("times", "bold");
  doc.text("Kepada", MARGIN_X, y);
  doc.setFont("times", "normal");
  doc.text(kepadaLines, MARGIN_X + 30, y);
  y += kepadaLines.length * 5.5 + 4;

  // ---------- Isi surat ----------
  doc.setFontSize(12);
  doc.text("Dengan hormat,", MARGIN_X, y);
  y += 8;

  for (const p of paragraf) {
    const lines = doc.splitTextToSize(p, CONTENT_W);
    ensure(lines.length * 6 + 4);
    doc.text(lines, MARGIN_X, y);
    y += lines.length * 6 + 3;
  }

  // ---------- Penutup ----------
  doc.setFontSize(12);
  const penutupLines = doc.splitTextToSize(data.penutup || " ", CONTENT_W);
  ensure(penutupLines.length * 6 + 4);
  doc.text(penutupLines, MARGIN_X, y);
  y += penutupLines.length * 6 + 8;

  // ---------- Tanda tangan ----------
  ensure(58);
  const ttdW = 72;
  const ttdX = PAGE_W - MARGIN_X - ttdW;
  y = Math.max(y, PAGE_H - MARGIN_BOTTOM - 50);

  doc.setFontSize(11);
  doc.setFont("times", "normal");
  doc.text(data.jabatan || " ", ttdX + ttdW / 2, y, { align: "center" });
  y += 8;
  doc.text(formatTanggal(data.tanggal), ttdX + ttdW / 2, y, { align: "center" });
  y += 26;
  doc.setFont("times", "bold");
  doc.text(data.nama || " ", ttdX + ttdW / 2, y, { align: "center" });
  const namaW = doc.getTextWidth(data.nama || " ");
  doc.setLineWidth(0.2);
  doc.line(
    ttdX + ttdW / 2 - namaW / 2,
    y + 1.2,
    ttdX + ttdW / 2 + namaW / 2,
    y + 1.2
  );

  doc.save(fileName(data));
}
