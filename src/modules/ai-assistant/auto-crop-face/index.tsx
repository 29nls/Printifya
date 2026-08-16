import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";
import CropperEditor from "../../photo-studio/shared/CropperEditor";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import { downloadUrl } from "../../shared/downloadUrl";
import { autoCropFace } from "./autocrop";
import {
  clearFacePercent,
  loadFacePercent,
  saveFacePercent,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
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

type Step = "upload" | "edit" | "result" | "noface";

export default function AutoCropFacePage() {
  const [size, setSize] = useState<PasFotoSize>(PRESETS[1]);
  const [step, setStep] = useState<Step>("upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  /** Proporsi wajah dalam tinggi hasil (zoom), default 50 — sama seperti autocrop; tersimpan di localStorage. */
  const [facePercent, setFacePercent] = useState(loadFacePercent);

  useEffect(() => {
    saveFacePercent(facePercent);
  }, [facePercent]);
  /** Awalan nama default saat hasil dikirim ke Auto Layout (label lembar). */
  const [layoutPrefix, setLayoutPrefix] = useState("auto-");
  const [cropping, setCropping] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSeq = useRef(0);
  const navigate = useNavigate();

  // Bersihkan object URL lama saat diganti / komponen dilepas.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  /**
   * Jalankan crop otomatis (pola autocrop): deteksi wajah terbesar →
   * kotak crop terpusat dengan zoom facePercent → resize persis ukuran output.
   * Bila wajah tidak terdeteksi, masuk step "noface" (autocrop mengembalikan
   * hasil kosong). Hasil lama diabaikan bila ada proses auto yang lebih baru.
   */
  const runAuto = async (src: string, s: PasFotoSize, percent: number) => {
    const seq = ++autoSeq.current;
    setCropping(true);
    setError("");
    try {
      const result = await autoCropFace(src, s.widthPx, s.heightPx, percent);
      if (seq !== autoSeq.current) return;
      if (result) {
        setCroppedUrl(result.dataUrl);
        setStep("result");
      } else {
        setStep("noface");
      }
    } catch (e) {
      if (seq !== autoSeq.current) return;
      setError(e instanceof Error ? e.message : "Gagal memproses gambar.");
      setStep("upload");
    } finally {
      if (seq === autoSeq.current) setCropping(false);
    }
  };

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    // Langsung auto-crop tanpa step manual (perilaku autocrop).
    const url = URL.createObjectURL(file);
    setFileName(file.name);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    void runAuto(url, size, facePercent);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** Ganti rasio output: hasil lama tidak valid, jalankan ulang auto-crop. */
  const selectSize = (s: PasFotoSize) => {
    if (s.id === size.id) return;
    setSize(s);
    setCroppedUrl(null);
    setError("");
    if (originalUrl) void runAuto(originalUrl, s, facePercent);
    else setStep("upload");
  };

  const changeFacePercent = (percent: number) => {
    setFacePercent(percent);
    if (originalUrl) void runAuto(originalUrl, size, percent);
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearFacePercent();
    setFacePercent(50);
    if (originalUrl) void runAuto(originalUrl, size, 50);
  };

  const download = () => {
    if (!croppedUrl) return;
    downloadUrl(croppedUrl, `${size.fileName}.png`);
  };

  /** Teruskan hasil crop ke alur Pas Foto 3x4 (crop ulang + template A4). */
  const forwardToPasFoto = () => {
    if (!croppedUrl) return;
    setPendingPasFoto(croppedUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  /** Kirim hasil ke Auto Layout untuk disusun ke lembar A4. */
  const forwardToLayout = () => {
    if (!croppedUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || size.title;
    setPendingLayoutPhoto(croppedUrl, `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  };

  return (
    <div className="pas-foto-page">
      <header className="module-header">
        <span className="module-icon">😀</span>
        <div>
          <h1>Auto Crop Face</h1>
          <p>
            Crop otomatis terpusat pada wajah terbesar — pola{" "}
            <code>leblancfg/autocrop</code>: upload, wajah dideteksi, langsung
            dipotong &amp; di-resize ke ukuran pas foto. Tanpa langkah manual.
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
            <div className="upload-icon">{cropping ? "🔍" : "📤"}</div>
            <h3>
              {cropping
                ? "Mendeteksi wajah & memotong…"
                : "Seret & letakkan foto di sini"}
            </h3>
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
            💡 Mengikuti <code>autocrop</code>: wajah <strong>terbesar</strong>{" "}
            dideteksi, kotak crop dihitung terpusat pada wajah (proporsi wajah
            diatur di bawah), dan hasil di-resize persis{" "}
            <strong>
              {size.widthPx} × {size.heightPx} px @ 300 DPI
            </strong>{" "}
            ({size.label}). Bila wajah tidak terdeteksi, hasil tidak dibuat —
            kamu bisa turun manual lewat "Edit Manual".
          </p>
        </section>
      )}

      {step === "edit" && originalUrl && (
        <CropperEditor
          key={originalUrl}
          size={size}
          src={originalUrl}
          fileName={fileName}
          onCancel={() => setStep(originalUrl && croppedUrl ? "result" : "upload")}
          onApply={(url) => {
            setCroppedUrl(url);
            setStep("result");
          }}
        />
      )}

      {step === "noface" && (
        <section className="panel">
          <h2>😕 Wajah tidak terdeteksi</h2>
          <p style={{ color: "var(--text-muted)", lineHeight: 1.7 }}>
            Seperti <code>autocrop</code>, hasil tidak dibuat bila tidak ada
            wajah yang ditemukan. Kamu bisa memotong secara manual, atau coba
            foto lain dengan latar lebih kontras dan wajah menghadap kamera.
          </p>
          <div className="result-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep("edit")}
            >
              ✏️ Edit Manual
            </button>
            <button type="button" className="btn" onClick={() => setStep("upload")}>
              🔄 Foto Lain
            </button>
          </div>
        </section>
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
                <li>
                  <span>Proporsi wajah</span>
                  <strong>{facePercent}%</strong>
                </li>
              </ul>

              {/* Proporsi wajah = zoom autocrop (--facePercent). */}
              <div className="sheet-settings">
                <label>
                  🔍 Proporsi wajah di hasil (zoom)
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={facePercent}
                    onChange={(e) => changeFacePercent(Number(e.target.value))}
                    style={{ width: 220 }}
                  />
                </label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => originalUrl && runAuto(originalUrl, size, facePercent)}
                  disabled={cropping}
                >
                  ✨ Auto Crop Ulang
                </button>
                <ResetPreferencesButton
                  title="Hapus zoom (proporsi wajah) tersimpan modul ini"
                  onReset={handleResetPrefs}
                />
              </div>
              <p className="hint">
                Nilai 50% = wajah mengisi separuh tinggi hasil (default{" "}
                <code>autocrop</code>); makin besar, makin dekat (zoom in).
                Crop otomatis dihitung ulang setiap slider digeser.
              </p>

              <label className="layout-prefix">
                🧩 Awalan label di lembar Auto Layout
                <input
                  type="text"
                  value={layoutPrefix}
                  placeholder="mis. auto-"
                  onChange={(e) => setLayoutPrefix(e.target.value)}
                />
              </label>

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
                  onClick={forwardToLayout}
                >
                  🧩 Susun ke Lembar A4
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
                  ✏️ Edit Manual
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
