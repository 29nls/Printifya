import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  applyBackgroundColor,
  removeBackground,
  type RemoveBgOptions,
} from "./bgRemove";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import {
  clearBgOptions,
  loadLayoutPrefix,
  loadSegOptions,
  saveLayoutPrefix,
  saveSegOptions,
} from "./bgOptionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
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
  // Awalan nama terusan — default dari localStorage (pola storage.ts).
  const [layoutPrefix, setLayoutPrefix] = useState(loadLayoutPrefix);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Opsi segmen ala rembg (--post-process-mask, -a, --alpha-matting-erode-size)
  // — default dari localStorage, disimpan ulang setiap berubah.
  const [postProcess, setPostProcess] = useState(() => loadSegOptions().postProcess);
  const [matting, setMatting] = useState(() => loadSegOptions().matting);
  const [erodeSize, setErodeSize] = useState(() => loadSegOptions().erodeSize);

  // Persist opsi segmen & awalan label.
  useEffect(() => {
    saveSegOptions({ postProcess, matting, erodeSize });
  }, [postProcess, matting, erodeSize]);
  useEffect(() => {
    saveLayoutPrefix(layoutPrefix);
  }, [layoutPrefix]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Kanvas hasil transparan (sumber untuk pewarnaan ulang tanpa reproses).
  const transparentRef = useRef<HTMLCanvasElement | null>(null);
  // Mask grayscale resolusi penuh (untuk tombol "Unduh Mask").
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  // Gambar asli yang sudah dimuat (untuk reproses saat opsi berubah).
  const imgRef = useRef<HTMLImageElement | null>(null);
  const navigate = useNavigate();

  const clampErode = (raw: string) => {
    const n = Number(raw);
    if (Number.isNaN(n)) return 0;
    return Math.min(30, Math.max(0, Math.round(n)));
  };

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
      imgRef.current = img;
      processImage(img, {
        postProcess,
        alphaMatting: matting,
        erodeSize,
      }, () => URL.revokeObjectURL(url));
    };
    img.onerror = () => {
      setError("Gagal membaca gambar.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
    setOriginalUrl(url);
  };

  /**
   * Jalankan penghapusan latar dengan opsi segmen (pola rembg). Setelah
   * selesai, warna latar yang sedang dipilih diterapkan ulang ke hasil.
   */
  const processImage = (
    image: HTMLImageElement,
    opts: RemoveBgOptions,
    onDone?: () => void
  ) => {
    setProcessing(true);
    // Beri kesempatan indikator "Memproses…" ter-render dulu.
    setTimeout(() => {
      try {
        const { canvas, mask, foregroundRatio } = removeBackground(image, opts);
        transparentRef.current = canvas;
        maskRef.current = mask;
        setDims({ w: canvas.width, h: canvas.height });
        const bgOpt = BG_OPTIONS.find((o) => o.id === bgId);
        setResultUrl(
          bgOpt?.hex
            ? applyBackgroundColor(canvas, bgOpt.hex).toDataURL("image/png")
            : canvas.toDataURL("image/png")
        );
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
        onDone?.();
      }
    }, 60);
  };

  const setPost = (v: boolean) => {
    setPostProcess(v);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess: v, alphaMatting: matting, erodeSize });
  };

  const setMatt = (v: boolean) => {
    setMatting(v);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess, alphaMatting: v, erodeSize });
  };

  const setErode = (n: number) => {
    setErodeSize(n);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess, alphaMatting: matting, erodeSize: n });
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearBgOptions();
    setPostProcess(true);
    setMatting(false);
    setErodeSize(10);
    setLayoutPrefix("bg-");
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

  /** Ekspor mask alpha (padanan rembg `-om / --only-mask`). */
  const downloadMask = () => {
    const mask = maskRef.current;
    if (!mask) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "background-removed";
    const a = document.createElement("a");
    a.href = mask.toDataURL("image/png");
    a.download = `${base}-mask.png`;
    a.click();
  };

  /** Teruskan hasil (dengan warna latar terpilih) ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = () => {
    if (!resultUrl) return;
    setPendingPasFoto(resultUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  /** Kirim hasil (dengan warna latar terpilih) ke Auto Layout untuk lembar A4. */
  const forwardToLayout = () => {
    if (!resultUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "background-removed";
    setPendingLayoutPhoto(resultUrl, `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
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
                  maskRef.current = null;
                  imgRef.current = null;
                  setBgId("transparent");
                  setPostProcess(true);
                  setMatting(false);
                  setErodeSize(10);
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

            <div className="seg-options">
              <span className="preset-label seg-label">Opsi segmen (pola rembg)</span>
              <ResetPreferencesButton
                title="Hapus opsi segmen & awalan label tersimpan modul ini"
                onReset={handleResetPrefs}
              />
            </div>
            <div className="seg-options">
              <label className="repeat-toggle">
                <input
                  type="checkbox"
                  checked={postProcess}
                  onChange={(e) => setPost(e.target.checked)}
                />
                Post-proses mask
              </label>
              <label className="repeat-toggle">
                <input
                  type="checkbox"
                  checked={matting}
                  onChange={(e) => setMatt(e.target.checked)}
                />
                Alpha matting (tepi halus)
              </label>
              {matting && (
                <label className="seg-erode">
                  Erosi tepi (px)
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={erodeSize}
                    onChange={(e) => setErode(clampErode(e.target.value))}
                  />
                </label>
              )}
            </div>
            <p className="hint">
              💡 <code>--post-process-mask</code>: opening morfologi untuk
              membersihkan bintik &amp; merapikan tepi mask.{" "}
              <code>-a / --alpha-matting-erode-size</code>: mask subjek di-erosi
              sebelum feathering sehingga tepi lebih lembut (default rembg: 10).
            </p>

            <label className="layout-prefix">
              🧩 Awalan label di lembar Auto Layout
              <input
                type="text"
                value={layoutPrefix}
                placeholder="mis. bg-"
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
                onClick={downloadMask}
                title="Ekspor mask alpha (putih = subjek), padanan rembg --only-mask"
              >
                ⬇️ Unduh Mask
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
