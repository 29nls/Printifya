import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  applyBackgroundColor,
  removeBackground,
} from "./bgRemove";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import "../../photo-studio/shared/style.css";
import "./style.css";

interface BgOption {
  id: string;
  name: string;
  /** Warna polos pengganti; null = pertahankan transparan. */
  hex: string | null;
}

const BG_OPTIONS: BgOption[] = [
  { id: "transparent", name: "Transparan", hex: null },
  { id: "white", name: "Putih", hex: "#ffffff" },
  { id: "blue", name: "Biru", hex: "#2e6db4" },
  { id: "red", name: "Merah", hex: "#c62828" },
];

type Step = "upload" | "result";

export default function BackgroundRemovalPage() {
  const [step, setStep] = useState<Step>("upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [bgId, setBgId] = useState<string>("transparent");
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Kanvas hasil transparan (sumber untuk pewarnaan ulang tanpa reproses).
  const transparentRef = useRef<HTMLCanvasElement | null>(null);
  const navigate = useNavigate();

  const handleFile = (file?: File | null) => {
    setError("");
    setWarning("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    setFileName(file.name);
    const url = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      setProcessing(true);
      // Beri kesempatan indikator "Memproses…" ter-render dulu.
      setTimeout(() => {
        try {
          const { canvas, foregroundRatio } = removeBackground(img);
          transparentRef.current = canvas;
          setDims({ w: canvas.width, h: canvas.height });
          setResultUrl(canvas.toDataURL("image/png"));
          setWarning(
            foregroundRatio < 0.01
              ? "Seluruh gambar terdeteksi sebagai latar — coba foto dengan subjek yang jelas."
              : foregroundRatio < 0.25
                ? "Subjek terdeteksi kecil. Hasil terbaik untuk foto dengan latar polos (putih/biru/merah)."
                : ""
          );
          setStep("result");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Gagal memproses gambar.");
        } finally {
          setProcessing(false);
          URL.revokeObjectURL(url);
        }
      }, 60);
    };
    img.onerror = () => {
      setError("Gagal membaca gambar.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
    setOriginalUrl(url);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** Ganti latar: warna polos atau transparan (dari kanvas tersimpan). */
  const selectBg = (opt: BgOption) => {
    const canvas = transparentRef.current;
    if (!canvas) return;
    setBgId(opt.id);
    if (opt.hex) {
      setResultUrl(applyBackgroundColor(canvas, opt.hex).toDataURL("image/png"));
    } else {
      setResultUrl(canvas.toDataURL("image/png"));
    }
  };

  const download = () => {
    if (!resultUrl) return;
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `background-removed-${bgId}.png`;
    a.click();
  };

  /** Teruskan hasil (dengan warna latar terpilih) ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = () => {
    if (!resultUrl) return;
    setPendingPasFoto(resultUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  return (
    <div className="bg-removal-page">
      <header className="module-header">
        <span className="module-icon">✂️</span>
        <div>
          <h1>Background Removal</h1>
          <p>
            Hapus latar belakang secara otomatis (heuristik warna kulit +
            flood fill dari tepi) lalu ganti dengan warna polos atau biarkan
            transparan.
          </p>
        </div>
      </header>

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
            💡 Cara kerja: warna latar diambil dari tepi gambar, lalu dihapus
            dengan penyebaran (flood fill) yang berhenti di kulit dan warna
            yang jauh dari latar. Paling akurat untuk latar polos — standar
            foto paspor / visa.
          </p>
        </section>
      )}

      {processing && (
        <section className="panel">
          <div className="processing-row">
            <span className="spinner" />
            <span>Memproses latar belakang…</span>
          </div>
        </section>
      )}

      {step === "result" && resultUrl && originalUrl && (
        <div className="result">
          <div className="bg-compare">
            <figure>
              <figcaption>Sebelum (asli)</figcaption>
              <img
                src={originalUrl}
                alt="Foto asli"
                className="bg-preview-img"
              />
            </figure>
            <figure>
              <figcaption>
                Sesudah{" "}
                {bgId === "transparent"
                  ? "(latar transparan)"
                  : `(latar ${
                      BG_OPTIONS.find((o) => o.id === bgId)?.name.toLowerCase() ??
                      "warna"
                    })`}
              </figcaption>
              <div className="checkerboard">
                <img
                  src={resultUrl}
                  alt="Hasil penghapusan latar"
                  className="bg-preview-img"
                />
              </div>
            </figure>
          </div>

          <section className="panel">
            <div className="file-row">
              <span>
                🖼️ Foto: <strong>{fileName}</strong>
                {dims && (
                  <span className="dims">
                    {" "}
                    — {dims.w} × {dims.h} px
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStep("upload");
                  setResultUrl(null);
                  setOriginalUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  transparentRef.current = null;
                  setBgId("transparent");
                }}
              >
                🔄 Foto Lain
              </button>
            </div>

            <span className="preset-label">Latar pengganti</span>
            <div className="bg-options">
              {BG_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={o.id === bgId ? "chip active" : "chip"}
                  onClick={() => selectBg(o)}
                >
                  <span
                    className={
                      o.hex
                        ? "swatch"
                        : "swatch swatch-checker"
                    }
                    style={o.hex ? { background: o.hex } : undefined}
                  />
                  {o.name}
                </button>
              ))}
            </div>

            {warning && <p className="error">{warning}</p>}

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
            </div>
            <p className="hint">
              💡 PNG mempertahankan transparansi. Untuk cetak pas foto, pilih
              latar Putih/Biru/Merah sesuai ketentuan, lalu gunakan modul Photo
              Studio untuk crop &amp; template A4.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
