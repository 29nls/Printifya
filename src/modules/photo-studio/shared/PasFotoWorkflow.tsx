import { useEffect, useRef, useState } from "react";
import type { PasFotoSize } from "./pasFotoSize";
import CropperEditor from "./CropperEditor";
import A4SheetPreview from "./A4SheetPreview";
import {
  exportPasFotoPdf,
  fitsA4,
  maxCols,
  maxRows,
  printPasFotoPdf,
} from "./exportPdf";
import "./style.css";

type Step = "upload" | "edit" | "result";

interface PasFotoWorkflowProps {
  /** Ukuran pas foto aktif (awal). Wajib diisi; bila `presets` ada, diinisialisasi dari preset pertama. */
  size: PasFotoSize;
  /** Daftar preset ukuran (mode visa). Saat ada, tampil pemilih preset di atas halaman. */
  presets?: PasFotoSize[];
  /** Header modul. Default: diambil dari ukuran aktif. */
  header?: { title: string; description: string; icon: string };
  /** Sembunyikan header (dipakai modul yang merender header sendiri, mis. Custom Size). */
  showHeader?: boolean;
  /** Gambar awal (data URL) yang langsung masuk ke langkah crop, mis. hasil modul lain. */
  initialImage?: string;
}

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
export default function PasFotoWorkflow({
  size,
  presets,
  header,
  showHeader = true,
  initialImage,
}: PasFotoWorkflowProps) {
  const DEFAULT_MARGIN_CM = 0.5;

  const [activeSize, setActiveSize] = useState<PasFotoSize>(size);
  // Batas input (maks di margin minimal) vs default grid (maks di margin default).
  const maxC = maxCols(activeSize);
  const maxR = maxRows(activeSize);

  const [step, setStep] = useState<Step>(initialImage ? "edit" : "upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(
    initialImage ?? null
  );
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState(
    initialImage ? "gambar-import.png" : ""
  );
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cols, setCols] = useState(maxCols(activeSize, DEFAULT_MARGIN_CM));
  const [rows, setRows] = useState(maxRows(activeSize, DEFAULT_MARGIN_CM));
  const [marginCm, setMarginCm] = useState(DEFAULT_MARGIN_CM);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const canExport = fitsA4(activeSize, cols, rows, marginCm);
  const headerInfo =
    header ?? {
      title: activeSize.title,
      description: activeSize.description,
      icon: activeSize.icon,
    };

  // Sinkronkan ukuran aktif bila prop `size` berubah (mode ukuran kustom).
  // Foto yang sudah dicrop tidak valid lagi, jadi ulangi crop foto asli.
  useEffect(() => {
    if (size.id === activeSize.id) return;
    setActiveSize(size);
    setCroppedUrl(null);
    setCols(maxCols(size, DEFAULT_MARGIN_CM));
    setRows(maxRows(size, DEFAULT_MARGIN_CM));
    setError("");
    setStep(originalUrl ? "edit" : "upload");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

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

  /** Ganti preset ukuran: hasil crop lama tidak valid lagi, jadi ulangi crop foto asli. */
  const selectSize = (s: PasFotoSize) => {
    if (s.id === activeSize.id) return;
    setActiveSize(s);
    setCroppedUrl(null);
    setCols(maxCols(s, DEFAULT_MARGIN_CM));
    setRows(maxRows(s, DEFAULT_MARGIN_CM));
    setError("");
    setStep(originalUrl ? "edit" : "upload");
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement("a");
    a.href = croppedUrl;
    a.download = `${activeSize.fileName}.png`;
    a.click();
  };

  const handleExportPdf = async () => {
    if (!croppedUrl || !canExport || exporting) return;
    setError("");
    setExporting(true);
    try {
      await exportPasFotoPdf(activeSize, croppedUrl, { cols, rows, marginCm });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    if (!croppedUrl || !canExport || printing) return;
    setError("");
    setPrinting(true);
    try {
      const allowed = await printPasFotoPdf(activeSize, croppedUrl, {
        cols,
        rows,
        marginCm,
      });
      if (!allowed) {
        setError(
          "Popup diblokir browser. Izinkan pop-up untuk membuka dialog cetak."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="pas-foto-page">
      {showHeader && (
        <header className="module-header">
          <span className="module-icon">{headerInfo.icon}</span>
          <div>
            <h1>{headerInfo.title}</h1>
            <p>{headerInfo.description}</p>
          </div>
        </header>
      )}

      {presets && presets.length > 0 && (
        <div className="preset-picker">
          <span className="preset-label">Pilih negara / jenis visa</span>
          <div className="preset-chips">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === activeSize.id ? "chip active" : "chip"}
                onClick={() => selectSize(p)}
              >
                {p.title}
              </button>
            ))}
          </div>
          {activeSize.note && <p className="preset-note">ℹ️ {activeSize.note}</p>}
        </div>
      )}

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
              {activeSize.widthPx} × {activeSize.heightPx} px @{" "}
              {activeSize.dpi ?? 300} DPI
            </strong>{" "}
            — ukuran cetak {activeSize.label}, siap cetak di printer biasa.
          </p>
        </section>
      )}

      {step === "edit" && originalUrl && (
        <CropperEditor
          key={originalUrl}
          size={activeSize}
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
                  alt={`Hasil ${activeSize.title}`}
                  className="print-size"
                  style={{
                    width: `${activeSize.widthMm / 10}cm`,
                    height: `${activeSize.heightMm / 10}cm`,
                  }}
                />
              </div>
              <p className="caption">Ukuran cetak sebenarnya ({activeSize.label})</p>
            </div>

            <div className="result-info">
              <h2>Hasil Pas Foto</h2>
              <ul className="info-list">
                <li>
                  <span>Jenis</span>
                  <strong>{activeSize.title}</strong>
                </li>
                <li>
                  <span>Ukuran cetak</span>
                  <strong>{activeSize.label}</strong>
                </li>
                <li>
                  <span>Resolusi</span>
                  <strong>
                    {activeSize.widthPx} × {activeSize.heightPx} px
                  </strong>
                </li>
                <li>
                  <span>DPI</span>
                  <strong>{activeSize.dpi ?? 300}</strong>
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
                disabled={!canExport || exporting || printing}
                onClick={handlePrint}
              >
                {printing ? "Menyiapkan PDF…" : "🖨️ Cetak"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canExport || exporting || printing}
                onClick={handleExportPdf}
              >
                {exporting ? "Menyiapkan PDF…" : "⬇️ Ekspor PDF A4"}
              </button>
            </div>

            {error && <p className="error">{error}</p>}

            {!canExport && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman A4 dengan margin {marginCm} cm.
                Kurangi kolom/baris atau perbesar margin.
              </p>
            )}

            <A4SheetPreview
              size={activeSize}
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
