import { useEffect, useRef, useState } from "react";
import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";
import A4SheetPreview from "../../photo-studio/shared/A4SheetPreview";
import { fitsA4, maxCols, maxRows } from "../../photo-studio/shared/exportPdf";
import { buildHtmlSheet, printHtmlSheet } from "./printHtml";
import "../../photo-studio/shared/style.css";
import "./style.css";

const PRESETS: PasFotoSize[] = [
  {
    id: "2x3",
    title: "Pas Foto 2x3",
    label: "2 × 3 cm",
    description: "Template pas foto 2×3 cm.",
    icon: "🪪",
    widthPx: 236,
    heightPx: 354,
    widthMm: 20,
    heightMm: 30,
    fileName: "pas-foto-2x3",
  },
  {
    id: "3x4",
    title: "Pas Foto 3x4",
    label: "3 × 4 cm",
    description: "Template pas foto 3×4 cm.",
    icon: "🪪",
    widthPx: 354,
    heightPx: 472,
    widthMm: 30,
    heightMm: 40,
    fileName: "pas-foto-3x4",
  },
  {
    id: "4x6",
    title: "Pas Foto 4x6",
    label: "4 × 6 cm",
    description: "Template pas foto 4×6 cm.",
    icon: "🪪",
    widthPx: 472,
    heightPx: 709,
    widthMm: 40,
    heightMm: 60,
    fileName: "pas-foto-4x6",
  },
];

const DEFAULT_MARGIN_CM = 0.5;

const clampInt = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const clampNum = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
};

export default function PrinterLokalPage() {
  const [size, setSize] = useState<PasFotoSize>(PRESETS[0]);
  const [src, setSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cols, setCols] = useState(maxCols(PRESETS[0], DEFAULT_MARGIN_CM));
  const [rows, setRows] = useState(maxRows(PRESETS[0], DEFAULT_MARGIN_CM));
  const [marginCm, setMarginCm] = useState(DEFAULT_MARGIN_CM);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const maxC = maxCols(size);
  const maxR = maxRows(size);
  const canPrint = src !== null && fitsA4(size, cols, rows, marginCm);

  useEffect(() => {
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [src]);

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    setFileName(file.name);
    setSrc((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const selectSize = (s: PasFotoSize) => {
    setSize(s);
    setCols(maxCols(s, DEFAULT_MARGIN_CM));
    setRows(maxRows(s, DEFAULT_MARGIN_CM));
    setError("");
  };

  const handlePrint = () => {
    if (!src || !canPrint || printing) return;
    setError("");
    setPrinting(true);
    try {
      const html = buildHtmlSheet(src, size, { cols, rows, marginCm });
      const ok = printHtmlSheet(html);
      if (!ok) {
        setError("Tidak bisa membuat iframe cetak di browser ini.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="printer-lokal-page">
      <header className="module-header">
        <span className="module-icon">🖨️</span>
        <div>
          <h1>Printer Lokal</h1>
          <p>
            Cetak template A4 langsung ke printer lokal lewat dialog browser —
            tanpa jsPDF, cukup HTML + iframe print.
          </p>
        </div>
      </header>

      <section className="panel">
        <p className="info-note">
          💡 Cara kerja: template cetak dirender sebagai dokumen HTML (ukuran
          foto presisi dalam mm), dimuat di iframe tersembunyi, lalu memicu
          dialog cetak browser. Pilih printer lokal Anda di dialog. Untuk
          meng-crop wajah terlebih dahulu, gunakan modul Photo Studio.
        </p>

        {!src && (
          <div
            className={dragOver ? "upload-zone dragging" : "upload-zone"}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="upload-icon">📤</div>
            <h3>Seret & letakkan foto di sini</h3>
            <p>atau klik untuk memilih file — JPG, PNG, atau WebP</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && <p className="error">{error}</p>}
      </section>

      {src && (
        <>
          <section className="panel">
            <div className="file-row">
              <span>
                🖼️ Foto terpilih: <strong>{fileName}</strong>
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setSrc(null);
                  setFileName("");
                }}
              >
                🔄 Ganti Foto
              </button>
            </div>

            <span className="preset-label">Ukuran pas foto</span>
            <div className="preset-chips">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === size.id ? "chip active" : "chip"}
                  onClick={() => selectSize(p)}
                >
                  {p.title}
                </button>
              ))}
            </div>

            <div className="sheet-settings">
              <label>
                Kolom
                <input
                  type="number"
                  min={1}
                  max={maxC}
                  value={cols}
                  onChange={(e) => setCols(clampInt(e.target.value, 1, maxC))}
                />
              </label>
              <label>
                Baris
                <input
                  type="number"
                  min={1}
                  max={maxR}
                  value={rows}
                  onChange={(e) => setRows(clampInt(e.target.value, 1, maxR))}
                />
              </label>
              <label>
                Margin (cm)
                <input
                  type="number"
                  min={0.2}
                  max={1.5}
                  step={0.1}
                  value={marginCm}
                  onChange={(e) =>
                    setMarginCm(clampNum(e.target.value, 0.2, 1.5))
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canPrint || printing}
                onClick={handlePrint}
              >
                {printing ? "Menyiapkan…" : "🖨️ Cetak via Browser"}
              </button>
            </div>

            {!canPrint && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman A4 dengan margin{" "}
                {marginCm} cm. Kurangi kolom/baris atau perbesar margin.
              </p>
            )}
          </section>

          <section className="panel">
            <h2>Pratinjau Template</h2>
            <A4SheetPreview
              size={size}
              src={src}
              cols={cols}
              rows={rows}
              marginCm={marginCm}
            />
          </section>
        </>
      )}
    </div>
  );
}
