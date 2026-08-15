import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";
import CropperEditor from "../../photo-studio/shared/CropperEditor";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import "../../photo-studio/shared/style.css";

/** Rasio output pas foto yang didukung Auto Crop Face. */
const PRESETS: PasFotoSize[] = [
  {
    id: "2x3",
    title: "2 × 3 cm",
    label: "2 × 3 cm",
    description: "Pas foto 2×3 cm.",
    icon: "🪪",
    widthPx: 236,
    heightPx: 354,
    widthMm: 20,
    heightMm: 30,
    fileName: "auto-crop-2x3",
  },
  {
    id: "3x4",
    title: "3 × 4 cm",
    label: "3 × 4 cm",
    description: "Pas foto 3×4 cm.",
    icon: "🪪",
    widthPx: 354,
    heightPx: 472,
    widthMm: 30,
    heightMm: 40,
    fileName: "auto-crop-3x4",
  },
  {
    id: "4x6",
    title: "4 × 6 cm",
    label: "4 × 6 cm",
    description: "Pas foto 4×6 cm.",
    icon: "🪪",
    widthPx: 472,
    heightPx: 709,
    widthMm: 40,
    heightMm: 60,
    fileName: "auto-crop-4x6",
  },
  {
    id: "1x1",
    title: "1 × 1 in",
    label: "1 × 1 in",
    description: "Persegi 1×1 inci (standar visa AS).",
    icon: "🪪",
    widthPx: 600,
    heightPx: 600,
    widthMm: 25.4,
    heightMm: 25.4,
    fileName: "auto-crop-1x1",
  },
];

type Step = "upload" | "edit" | "result";

export default function AutoCropFacePage() {
  const [size, setSize] = useState<PasFotoSize>(PRESETS[1]);
  const [step, setStep] = useState<Step>("upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

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

  /** Ganti rasio output: hasil crop lama tidak valid, ulangi crop foto asli. */
  const selectSize = (s: PasFotoSize) => {
    if (s.id === size.id) return;
    setSize(s);
    setCroppedUrl(null);
    setError("");
    setStep(originalUrl ? "edit" : "upload");
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement("a");
    a.href = croppedUrl;
    a.download = `${size.fileName}.png`;
    a.click();
  };

  /** Teruskan hasil crop ke alur Pas Foto 3x4 (crop ulang + template A4). */
  const forwardToPasFoto = () => {
    if (!croppedUrl) return;
    setPendingPasFoto(croppedUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  return (
    <div className="pas-foto-page">
      <header className="module-header">
        <span className="module-icon">😀</span>
        <div>
          <h1>Auto Crop Face</h1>
          <p>
            Deteksi wajah otomatis lalu crop dengan framing pas foto — cukup
            upload, kotak crop langsung mengarah ke wajah.
          </p>
        </div>
      </header>

      <div className="preset-picker">
        <span className="preset-label">Rasio output</span>
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
      </div>

      {step === "upload" && (
        <section className="panel">
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
            💡 Wajah dideteksi otomatis saat editor terbuka — kotak crop
            diposisikan dengan framing pas foto (kepala ±60% tinggi, mata di
            sepertiga atas). Geser kotak jika perlu. Hasil akhir:{" "}
            <strong>
              {size.widthPx} × {size.heightPx} px @ 300 DPI
            </strong>{" "}
            ({size.label}).
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
              <h2>Hasil Auto Crop</h2>
              <ul className="info-list">
                <li>
                  <span>Rasio</span>
                  <strong>{size.title}</strong>
                </li>
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
                  <span>Format</span>
                  <strong>PNG</strong>
                </li>
              </ul>

              <div className="result-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={forwardToPasFoto}
                >
                  🪪 Jadikan Pas Foto 3x4
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={download}
                >
                  ⬇️ Unduh PNG
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setStep("edit")}
                >
                  ✏️ Edit Ulang
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setStep("upload")}
                >
                  🔄 Foto Lain
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
