import { useEffect, useRef, useState } from "react";
import type { PasFotoSize } from "./pasFotoSize";
import CropperEditor from "./CropperEditor";
import A4SheetPreview from "./A4SheetPreview";
import { exportPasFotoPdf, fitsA4, maxCols, maxRows } from "./exportPdf";
import "./style.css";

type Step = "upload" | "edit" | "result";

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

/** Alur lengkap pas foto: upload → crop → hasil + template cetak A4 + ekspor PDF. */
export default function PasFotoWorkflow({ size }: { size: PasFotoSize }) {
  const maxC = maxCols(size);
  const maxR = maxRows(size);

  const [step, setStep] = useState<Step>("upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cols, setCols] = useState(maxC);
  const [rows, setRows] = useState(maxR);
  const [marginCm, setMarginCm] = useState(0.5);
  const [exporting, setExporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canExport = fitsA4(size, cols, rows, marginCm);

  // Bersihkan object URL lama saat diganti / komponen dilepas.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    setFileName(file.name);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setStep("edit");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement("a");
    a.href = croppedUrl;
    a.download = `${size.fileName}.png`;
    a.click();
  };

  const handleExportPdf = async () => {
    if (!croppedUrl || !canExport || exporting) return;
    setExporting(true);
    try {
      await exportPasFotoPdf(size, croppedUrl, { cols, rows, marginCm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="pas-foto-page">
      <header className="module-header">
        <span className="module-icon">{size.icon}</span>
        <div>
          <h1>{size.title}</h1>
          <p>{size.description}</p>
        </div>
      </header>

      {step === "upload" && (
        <section className="panel upload-section">
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

          <p className="hint">
            💡 Hasil akhir:{" "}
            <strong>
              {size.widthPx} × {size.heightPx} px @ 300 DPI
            </strong>{" "}
            — ukuran cetak {size.label}, siap cetak di printer biasa.
          </p>
        </section>
      )}

      {step === "edit" && originalUrl && (
        <CropperEditor
          key={originalUrl}
          size={size}
          src={originalUrl}
          fileName={fileName}
          onCancel={() => setStep("upload")}
          onApply={(url) => {
            setCroppedUrl(url);
            setStep("result");
          }}
        />
      )}

      {step === "result" && croppedUrl && (
        <div className="result">
          <div className="result-layout">
            <div className="result-preview">
              <div className="print-frame">
                <img
                  src={croppedUrl}
                  alt={`Hasil ${size.title}`}
                  className="print-size"
                  style={{
                    width: `${size.widthMm / 10}cm`,
                    height: `${size.heightMm / 10}cm`,
                  }}
                />
              </div>
              <p className="caption">Ukuran cetak sebenarnya ({size.label})</p>
            </div>

            <div className="result-info">
              <h2>Hasil Pas Foto</h2>
              <ul className="info-list">
                <li>
                  <span>Ukuran cetak</span>
                  <strong>{size.label}</strong>
                </li>
                <li>
                  <span>Resolusi</span>
                  <strong>
                    {size.widthPx} × {size.heightPx} px
                  </strong>
                </li>
                <li>
                  <span>DPI</span>
                  <strong>300</strong>
                </li>
                <li>
                  <span>Format</span>
                  <strong>PNG (transparan)</strong>
                </li>
              </ul>

              <div className="result-actions">
                <button type="button" className="btn btn-primary" onClick={download}>
                  ⬇️ Unduh PNG
                </button>
                <button type="button" className="btn" onClick={() => setStep("edit")}>
                  ✏️ Edit Ulang
                </button>
                <button type="button" className="btn" onClick={() => setStep("upload")}>
                  🔄 Foto Lain
                </button>
              </div>
            </div>
          </div>

          <section className="panel sheet-section">
            <h2>Pratinjau Template Cetak A4</h2>

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
                  onChange={(e) => setMarginCm(clampNum(e.target.value, 0.2, 1.5))}
                />
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canExport || exporting}
                onClick={handleExportPdf}
              >
                {exporting ? "Menyiapkan PDF…" : "⬇️ Ekspor PDF A4"}
              </button>
            </div>

            {!canExport && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman A4 dengan margin {marginCm} cm.
                Kurangi kolom/baris atau perbesar margin.
              </p>
            )}

            <A4SheetPreview
              size={size}
              src={croppedUrl}
              cols={cols}
              rows={rows}
              marginCm={marginCm}
            />
          </section>
        </div>
      )}
    </div>
  );
}
