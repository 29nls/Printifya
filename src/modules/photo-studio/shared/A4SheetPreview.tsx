import { memo, useCallback, useRef, useState } from "react";
import {
  computeSheetLayout,
  orientedDims,
  scaleSheetLayout,
  sheetCellAtPoint,
  type SheetOrientation,
} from "./sheetLayout";
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
 * Satu sel grid lembar — di-MEMO agar ketikan (nama/teks Booth) atau perubahan
 * state lain di modul pemakai tidak me-render ulang puluhan <img> lembar yang
 * tidak berubah (diukur: ~1 dtk per ketikan pada batch 30 foto → milidetik).
 * Prop dipilih agar shallow-compare efektif: src/label string (nilai stabil),
 * angka/boolean primitif, dan handler stabil via useCallback di pemakai.
 */
interface SheetCellProps {
  index: number;
  src?: string;
  label?: string;
  labelPx: number;
  draggable: boolean;
  dragging: boolean;
  dropOver: boolean;
  interactive: boolean;
  onDragStart: (i: number) => void;
  onDragOver: (i: number, e: React.DragEvent) => void;
  onDragLeave: (i: number) => void;
  onDrop: (i: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

const SheetCell = memo(function SheetCell({
  index,
  src,
  label,
  labelPx,
  draggable,
  dragging,
  dropOver,
  interactive,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: SheetCellProps) {
  return (
    <div
      className={`sheet-cell${draggable ? " sheet-cell-draggable" : ""}${
        dropOver ? " sheet-cell-drop" : ""
      }`}
      draggable={draggable}
      data-dragging={interactive ? dragging : undefined}
      onDragStart={
        draggable
          ? (e) => {
              onDragStart(index);
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      onDragOver={
        draggable ? (e) => onDragOver(index, e) : undefined
      }
      onDragLeave={draggable ? () => onDragLeave(index) : undefined}
      onDrop={draggable ? (e) => onDrop(index, e) : undefined}
      onDragEnd={draggable ? onDragEnd : undefined}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="sheet-photo"
          draggable={interactive ? false : undefined}
        />
      ) : (
        <div className="sheet-photo sheet-photo-empty" />
      )}
      {label && (
        <span className="sheet-label" style={{ fontSize: labelPx }}>
          {label}
        </span>
      )}
    </div>
  );
});

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
  const sheetRef = useRef<HTMLDivElement>(null);
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

  // Tata letak dihitung dalam mm oleh helper yang sama dengan PDF & cetak
  // (grid + margin sentris), lalu diskalakan ke px pratinjau. Geometri sel
  // (posisi & area label) juga berasal dari sumber tunggal ini.
  const layout = computeSheetLayout(size, cols, rows, marginCm, p, orientation);
  const px = scale / 10; // px per mm
  const layoutPx = scaleSheetLayout(layout, px);
  const count = layoutPx.count;
  const sheetW = d.widthMm * px;
  const sheetH = d.heightMm * px;
  const { gridW, gridH, marginX: padX, marginY: padY } = layoutPx;
  const cellW = size.widthMm * px;
  const cellH = size.heightMm * px;
  // Resolusi target drop dari POSISI pointer (sumber tunggal sheetLayout),
  // dengan indeks sel event sebagai fallback — geometri drag ikut hitungan
  // yang sama dengan PDF/cetak. useCallback agar identitas handler stabil
  // antar render (SheetCell di-memo; handler baru tiap render membatalkan
  // memo pada semua sel).
  const dropTargetFromEvent = useCallback(
    (e: React.DragEvent): number => {
      const el = sheetRef.current;
      if (!el) return -1;
      const rect = el.getBoundingClientRect();
      return sheetCellAtPoint(
        e.clientX - rect.left - padX,
        e.clientY - rect.top - padY,
        cols,
        rows,
        cellW,
        cellH,
        layoutPx
      );
    },
    [padX, padY, cols, rows, cellW, cellH, layoutPx]
  );
  const handleDragStart = useCallback((i: number) => {
    setDragFrom(i);
    setDragOverIdx(null);
  }, []);
  const handleDragOver = useCallback(
    (i: number, e: React.DragEvent) => {
      if (dragFrom === null || dragFrom === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIdx(i);
    },
    [dragFrom]
  );
  const handleDragLeave = useCallback((i: number) => {
    setDragOverIdx((cur) => (cur === i ? null : cur));
  }, []);
  // `onDropPhoto` dibaca dari ref agar handleDrop tetap stabil walau pemakai
  // mengoper callback inline (identity baru tiap render) — tanpanya memo sel
  // batal di setiap render induk.
  const onDropPhotoRef = useRef(onDropPhoto);
  onDropPhotoRef.current = onDropPhoto;
  const handleDrop = useCallback(
    (i: number, e: React.DragEvent) => {
      e.preventDefault();
      setDragOverIdx(null);
      if (dragFrom === null) return;
      // Grid rapat (gap 0): posisi & indeks sel selalu sama;
      // hitungan posisi jadi sumber, indeks event fallback.
      const target = dropTargetFromEvent(e);
      const dest = target >= 0 ? target : i;
      if (dest !== dragFrom) onDropPhotoRef.current?.(dragFrom, dest);
      setDragFrom(null);
    },
    [dragFrom, dropTargetFromEvent]
  );
  const handleDragEnd = useCallback(() => {
    setDragFrom(null);
    setDragOverIdx(null);
  }, []);

  const photos = srcs ?? (src ? Array.from({ length: count }, () => src) : []);
  const isMulti = srcs !== undefined;
  // Font label ikut skala agar tetap proporsional terhadap sel di kedua mode.
  const labelPx = labelSizePx * (scale / fitScale);
  const sheet = (
    <div
      ref={sheetRef}
      className="sheet"
      style={{ width: sheetW, height: sheetH, padding: `${padY}px ${padX}px` }}
    >
      <div
        className={`sheet-grid${cutLines ? " cut-lines" : ""}`}
        style={{
          gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
          gridTemplateRows: `repeat(${rows}, ${cellH}px)`,
          gap: 0,
          width: gridW,
          height: gridH,
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          <SheetCell
            key={i}
            index={i}
            src={photos[i]}
            label={labels?.[i]}
            labelPx={labelPx}
            draggable={interactive && !!photos[i]}
            dragging={dragFrom === i}
            dropOver={dragOverIdx === i}
            interactive={interactive}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
          />
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
