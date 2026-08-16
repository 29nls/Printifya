import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  computeAutoParams,
  enhanceImage,
  NEUTRAL_PARAMS,
  type EnhanceParams,
} from "./enhance";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import SyncedPhotoCompare from "../../shared/SyncedPhotoCompare";
import { downloadUrl } from "../../shared/downloadUrl";
import {
  clearEnhanceOptions,
  loadLayoutPrefix,
  saveLayoutPrefix,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

const PREVIEW_MAX = 1200; // px — sisi terpanjang pratinjau live

const SLIDERS: {
  key: keyof EnhanceParams;
  label: string;
  min: number;
  max: number;
  unit: string;
}[] = [
  { key: "brightness", label: "Kecerahan", min: -100, max: 100, unit: "" },
  { key: "contrast", label: "Kontras", min: -100, max: 100, unit: "" },
  { key: "sharpness", label: "Ketajaman", min: 0, max: 100, unit: "" },
];

export default function EnhancePhotoPage() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [params, setParams] = useState<EnhanceParams>(NEUTRAL_PARAMS);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [autoApplied, setAutoApplied] = useState(false);
  /** Awalan nama default saat hasil dikirim ke Auto Layout (label lembar).
   *  Default dari localStorage, disimpan ulang setiap berubah (pola
   *  optionsStorage.ts di Auto Crop Face). */
  const [layoutPrefix, setLayoutPrefix] = useState(loadLayoutPrefix);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    saveLayoutPrefix(layoutPrefix);
  }, [layoutPrefix]);

  // Pratinjau live dengan debounce singkat saat slider digeser.
  useEffect(() => {
    if (!img) return;
    const t = setTimeout(() => {
      try {
        setPreview(enhanceImage(img, params, PREVIEW_MAX));
      } catch {
        // gambar rusak — biarkan pratinjau lama
      }
    }, 40);
    return () => clearTimeout(t);
  }, [img, params]);

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
    const url = URL.createObjectURL(file);

    const image = new Image();
    image.onload = () => {
      setImg(image);
      setDims({ w: image.naturalWidth, h: image.naturalHeight });
      setParams(NEUTRAL_PARAMS);
      setAutoApplied(false);
      setOriginalUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    };
    image.onerror = () => {
      setError("Gagal membaca gambar.");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** Analisis histogram lalu set slider ke nilai yang disarankan. */
  const autoEnhance = () => {
    if (!img) return;
    setParams(computeAutoParams(img));
    setAutoApplied(true);
  };

  const reset = () => {
    setParams(NEUTRAL_PARAMS);
    setAutoApplied(false);
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearEnhanceOptions();
    setLayoutPrefix("enhanced-");
  };

  const download = () => {
    if (!img) return;
    const full = enhanceImage(img, params);
    downloadUrl(full.toDataURL("image/png"), "enhanced-photo.png");
  };

  /** Kirim hasil enhance (resolusi penuh) ke Auto Layout untuk lembar A4. */
  const forwardToLayout = () => {
    if (!img) return;
    const full = enhanceImage(img, params);
    const base = fileName.replace(/\.[^.]+$/, "") || "enhanced-photo";
    setPendingLayoutPhoto(full.toDataURL("image/png"), `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  };

  return (
    <div className="enhance-page">
      <header className="module-header">
        <span className="module-icon">✨</span>
        <div>
          <h1>Enhance Photo</h1>
          <p>
            Perbaiki pencahayaan, kontras, dan ketajaman otomatis berbasis
            histogram — atau atur manual dengan slider, dan bandingkan
            sebelum/sesudah.
          </p>
        </div>
      </header>

      {!img && (
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
            💡 Klik <strong>Auto Perbaiki</strong> untuk koreksi otomatis:
            histogram luminance dibentangkan (persentil 1%–99%) ke rentang
            penuh dan titik tengah digeser ke abu-abu 128, lalu disesuaikan
            manual bila perlu. Semua proses berjalan lokal di browser.
          </p>
        </section>
      )}

      {img && originalUrl && (
        <>
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
                  setImg(null);
                  setPreview(null);
                  setOriginalUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setParams(NEUTRAL_PARAMS);
                  setAutoApplied(false);
                }}
              >
                🔄 Foto Lain
              </button>
            </div>

            <div className="enhance-controls">
              <div className="enhance-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={autoEnhance}
                >
                  ✨ Auto Perbaiki
                </button>
                <button type="button" className="btn" onClick={reset}>
                  ↺ Reset
                </button>
              </div>

              <div className="sliders">
                {SLIDERS.map((s) => (
                  <label key={s.key} className="slider-row">
                    <span className="slider-label">{s.label}</span>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      value={params[s.key]}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          [s.key]: Number(e.target.value),
                        }))
                      }
                    />
                    <span className="slider-value">
                      {params[s.key] > 0 ? "+" : ""}
                      {params[s.key]}
                      {s.unit}
                    </span>
                  </label>
                ))}
              </div>

              {autoApplied && (
                <p className="auto-note">
                  ✨ Auto diterapkan — geser slider untuk penyesuaian halus.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <SyncedPhotoCompare
              before={{ label: "Sebelum (asli)", src: originalUrl }}
              after={{ label: "Sesudah (enhance)", canvas: preview }}
            />

            <div className="prefs-row">
              <label className="layout-prefix">
                🧩 Awalan label di lembar Auto Layout
                <input
                  type="text"
                  value={layoutPrefix}
                  placeholder="mis. enhanced-"
                  onChange={(e) => setLayoutPrefix(e.target.value)}
                />
              </label>
              <ResetPreferencesButton
                title="Hapus awalan label tersimpan modul ini"
                onReset={handleResetPrefs}
              />
            </div>

            <div className="result-actions">
              <button type="button" className="btn btn-primary" onClick={download}>
                ⬇️ Unduh PNG (ukuran penuh)
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={forwardToLayout}
              >
                🧩 Susun ke Lembar A4
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
