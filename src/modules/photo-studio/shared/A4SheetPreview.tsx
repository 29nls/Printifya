import { useState } from "react";
import {
  orientedDims,
  type SheetOrientation,
} from "./exportPdf";
import type { PasFotoSize } from "./pasFotoSize";
import { getPaper, PAPER_A4, type PaperSize } from "./paperSize";

interface A4SheetPreviewProps {
  size: PasFotoSize;
  /** Satu gambar yang diulang di semua sel (pola pas foto). */
  src?: string;
  /** Banyak gambar: sel ke-i memakai srcs[i]; sel kosong bila foto habis. */
  srcs?: string[];
  cols: number;
  rows: number;
  marginCm?: number;
  /** Ukuran kertas lembar; default A4. */
  paper?: PaperSize;
  /** Orientasi lembar; default potret (otomatis lanskap bila grid lebih muat melintang). */
  orientation?: SheetOrientation;
  /** Label per foto (indeks sejajar dengan `srcs`); ditampilkan bila diisi. */
  labels?: string[];
  /** Ukuran font label pada pratinjau (px). */
  labelSizePx?: number;
  /**
   * Aktifkan drag antar sel: dipanggil saat foto di sel `from` dijatuhkan
   * ke sel `to` (indeks sel, bukan indeks foto). Tanpa prop ini, sel tidak
   * bisa di-drag (perilaku lama untuk pas foto & mode src).
   */
  onDropPhoto?: (from: number, to: number) => void;
  /** Garis potong putus-putus antar sel (sekat, mudah dipotong setelah cetak). */
  cutLines?: boolean;
}

const SCALE_MM = 2; // px per mm dasar (A4 → 420×594 px)
const MAX_DISPLAY = 560; // px — sisi terpanjang lembar pada pratinjau "sesuaikan layar"
const FULL_SCALE_MM = 96 / 25.4; // px per mm — ukuran cetak sungguhan (≈96 dpi)

/**
 * Pratinjau template cetak (default A4; bisa A3/A5/R2–R30): pas foto disusun
 * dalam grid (kolom × baris) dengan margin (cm) di tiap sisi lembar. Skala
 * pratinjau menyesuaikan agar lembar besar (mis. 30R) tetap muat di layar;
 * tombol "Ukuran penuh" beralih ke skala 1:1 (ukuran cetak sungguhan) dalam
 * wadah yang bisa di-scroll — cocok untuk kertas besar seperti A3/16R agar
 * sel foto terlihat jelas.
 * Mode `srcs` dipakai Auto Layout untuk menyusun banyak foto berbeda;
 * mode `src` mengulang satu gambar di semua sel (pola pas foto).
 */
export default function A4SheetPreview({
  size,
  src,
  srcs,
  cols,
  rows,
  marginCm = 0.5,
  paper,
  orientation = "portrait",
  labels,
  labelSizePx = 8,
  onDropPhoto,
  cutLines = false,
}: A4SheetPreviewProps) {
  const p = getPaper(paper?.id ?? PAPER_A4.id);
  const d = orientedDims(p, orientation);
  const [fullSize, setFullSize] = useState(false);
  // Drag antar sel (hanya aktif bila onDropPhoto disediakan).
  const interactive = onDropPhoto !== undefined;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  // Skala agar sisi terpanjang ≤ MAX_DISPLAY px (A4 tetap ±420×594).
  const fitScale =
    Math.min(SCALE_MM, MAX_DISPLAY / Math.max(d.widthMm, d.heightMm)) * 10; // px per cm
  // Ukuran penuh = ukuran cetak sungguhan (96 dpi).
  const fullScale = FULL_SCALE_MM * 10; // px per cm
  const scale = fullSize ? fullScale : fitScale;

  const count = cols * rows;
  const sheetW = (d.widthMm / 10) * scale;
  const sheetH = (d.heightMm / 10) * scale;
  const photoW = (size.widthMm / 10) * scale;
  const photoH = (size.heightMm / 10) * scale;
  const margin = marginCm * scale;
  const innerW = sheetW - margin * 2;
  const innerH = sheetH - margin * 2;

  const photos = srcs ?? (src ? Array.from({ length: count }, () => src) : []);
  const isMulti = srcs !== undefined;
  // Font label ikut skala agar tetap proporsional terhadap sel di kedua mode.
  const labelPx = labelSizePx * (scale / fitScale);
  const sheet = (
    <div
      className="sheet"
      style={{ width: sheetW, height: sheetH, padding: margin }}
    >
      <div
        className={`sheet-grid${cutLines ? " cut-lines" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, ${photoW}px)`,
          gridTemplateRows: `repeat(${rows}, ${photoH}px)`,
          gap: 0,
          width: innerW,
          height: innerH,
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className={`sheet-cell${interactive ? " sheet-cell-draggable" : ""}${
              dragOverIdx === i ? " sheet-cell-drop" : ""
            }`}
            draggable={interactive && !!photos[i]}
            data-dragging={interactive ? dragFrom === i : undefined}
            onDragStart={
              interactive
                ? (e) => {
                    setDragFrom(i);
                    setDragOverIdx(null);
                    e.dataTransfer.effectAllowed = "move";
                  }
                : undefined
            }
            onDragOver={
              interactive
                ? (e) => {
                    if (dragFrom === null || dragFrom === i) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDragOverIdx(i);
                  }
                : undefined
            }
            onDragLeave={
              interactive
                ? () => setDragOverIdx((cur) => (cur === i ? null : cur))
                : undefined
            }
            onDrop={
              interactive
                ? (e) => {
                    e.preventDefault();
                    setDragOverIdx(null);
                    if (dragFrom !== null && dragFrom !== i) {
                      onDropPhoto(dragFrom, i);
                    }
                    setDragFrom(null);
                  }
                : undefined
            }
            onDragEnd={
              interactive
                ? () => {
                    setDragFrom(null);
                    setDragOverIdx(null);
                  }
                : undefined
            }
          >
            {photos[i] ? (
              <img
                src={photos[i]}
                alt=""
                className="sheet-photo"
                draggable={interactive ? false : undefined}
              />
            ) : (
              <div className="sheet-photo sheet-photo-empty" />
            )}
            {labels?.[i] && (
              <span className="sheet-label" style={{ fontSize: labelPx }}>
                {labels[i]}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="sheet-preview">
      <div className="sheet-preview-head">
        <button
          type="button"
          className="btn"
          onClick={() => setFullSize((v) => !v)}
          title={
            fullSize
              ? "Kembali menyesuaikan lembar ke lebar layar"
              : "Tampilkan lembar pada ukuran cetak sungguhan (1:1), bisa di-scroll"
          }
        >
          {fullSize ? "🖼️ Sesuaikan layar" : "🔍 Ukuran penuh (1:1)"}
        </button>
      </div>
      {fullSize ? (
        <div className="sheet-preview-scroll">{sheet}</div>
      ) : (
        sheet
      )}
      <p className="sheet-caption">
        Template {p.name}
        {orientation === "landscape" && <span className="orientation-badge"> 🔃 lanskap</span>} ·{" "}
        {cols} × {rows} = {count} {isMulti ? "sel" : "salinan"}{" "}
        {size.label} (margin {marginCm} cm)
        {fullSize && (
          <>
            {" "}· <strong>ukuran 1:1</strong> — scroll untuk melihat seluruh lembar
          </>
        )}
      </p>
    </div>
  );
}
