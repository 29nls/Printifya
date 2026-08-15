import type { PasFotoSize } from "./pasFotoSize";

interface A4SheetPreviewProps {
  size: PasFotoSize;
  /** Satu gambar yang diulang di semua sel (pola pas foto). */
  src?: string;
  /** Banyak gambar: sel ke-i memakai srcs[i]; sel kosong bila foto habis. */
  srcs?: string[];
  cols: number;
  rows: number;
  marginCm?: number;
}

const SCALE = 20; // px per cm (lembar 420×594 px = A4 21×29,7 cm)
const SHEET_WIDTH = 420;
const SHEET_HEIGHT = 594;

/**
 * Pratinjau template cetak A4: pas foto disusun dalam grid
 * (kolom × baris) dengan margin (cm) di tiap sisi lembar.
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
}: A4SheetPreviewProps) {
  const count = cols * rows;
  const photoW = (size.widthMm / 10) * SCALE;
  const photoH = (size.heightMm / 10) * SCALE;
  const margin = marginCm * SCALE;
  const innerW = SHEET_WIDTH - margin * 2;
  const innerH = SHEET_HEIGHT - margin * 2;

  const photos = srcs ?? (src ? Array.from({ length: count }, () => src) : []);
  const isMulti = srcs !== undefined;

  return (
    <div className="sheet-preview">
      <div
        className="sheet"
        style={{ width: SHEET_WIDTH, height: SHEET_HEIGHT, padding: margin }}
      >
        <div
          className="sheet-grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, ${photoW}px)`,
            gridTemplateRows: `repeat(${rows}, ${photoH}px)`,
            gap: 0,
            width: innerW,
            height: innerH,
          }}
        >
          {Array.from({ length: count }).map((_, i) =>
            photos[i] ? (
              <img key={i} src={photos[i]} alt="" className="sheet-photo" />
            ) : (
              <div key={i} className="sheet-photo sheet-photo-empty" />
            )
          )}
        </div>
      </div>
      <p className="sheet-caption">
        Template A4 · {cols} × {rows} = {count} {isMulti ? "sel" : "salinan"}{" "}
        {size.label} (margin {marginCm} cm)
      </p>
    </div>
  );
}
