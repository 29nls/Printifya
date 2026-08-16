import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  computeAutoParams,
  enhanceImage,
  NEUTRAL_PARAMS,
  type EnhanceParams,
} from "./enhance";
import type {
  EnhancePhotoWorkerRequestNoId,
  EnhancePhotoWorkerResponse,
} from "./enhancePhotoWorkerApi";
import { createWorkerClient } from "../../shared/createWorkerClient";
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
  /** Operasi full-res yang sedang berjalan (busy state — UI tetap responsif
   *  karena pipeline berjalan di Web Worker). */
  const [busyOp, setBusyOp] = useState<"download" | "layout" | null>(null);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Web Worker pipeline full-res (enhancePixels + encode PNG) — foto besar
  // tidak membekukan UI; fallback thread utama bila browser tanpa Worker.
  const useWorker = typeof Worker !== "undefined";
  const enhanceWorkerClient = useMemo(
    () =>
      createWorkerClient<
        EnhancePhotoWorkerRequestNoId,
        EnhancePhotoWorkerResponse
      >({
        createWorker: () =>
          new Worker(new URL("./enhancePhoto.worker.ts", import.meta.url), {
            type: "module",
          }),
        errorMessage: "Worker gagal memproses foto.",
      }),
    []
  );

  // Hentikan worker saat komponen dilepas: tolak permintaan tertunda, terminate.
  useEffect(() => {
    return () => enhanceWorkerClient.terminate();
  }, [enhanceWorkerClient]);
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

  /**
   * Proses resolusi penuh → Blob PNG. Jalur worker: drawImage + getImageData
   * di thread utama (ringan), lalu `enhancePixels` + encode PNG
   * (`convertToBlob`) semua di Web Worker → hasil keluar sebagai Blob.
   * Fallback: `enhanceImage` sinkron + `toBlob` (jalur lama) bila browser
   * tanpa Worker. Hasil identik dengan jalur lama — `enhancePixels` adalah
   * sumber tunggal logika piksel.
   */
  const processFullRes = async (): Promise<Blob> => {
    if (!img) throw new Error("Tidak ada foto.");
    if (!useWorker) {
      const canvas = enhanceImage(img, params);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Gagal membuat PNG."))),
          "image/png"
        )
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas 2D tidak tersedia.");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = imageData.data.buffer as ArrayBuffer;
    const res = await enhanceWorkerClient.post(
      {
        type: "process",
        pixels: buffer,
        w: canvas.width,
        h: canvas.height,
        params,
      },
      [buffer]
    );
    if (!res.ok) throw new Error(res.error);
    return res.blob;
  };

  /** Bungkus operasi full-res dengan busy state + guard anti-konkurensi. */
  const withBusy =
    (op: "download" | "layout", fn: () => Promise<void>) =>
    async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusyOp(op);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memproses foto.");
      } finally {
        busyRef.current = false;
        setBusyOp(null);
      }
    };

  const download = withBusy("download", async () => {
    const blob = await processFullRes();
    downloadUrl(URL.createObjectURL(blob), "enhanced-photo.png");
  });

  /** Blob hasil → data URL (Auto Layout memakai data URL: modul tujuan bahkan
   *  me-revoke object URL masuknya saat double-mount StrictMode, jadi blob URL
   *  tidak aman untuk bridge). Base64 via FileReader berjalan di luar thread
   *  utama (baca blob async) — jauh lebih ringan daripada `canvas.toDataURL`
   *  sinkron pada resolusi penuh. */
  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () =>
        reject(new Error("Gagal mengonversi hasil ke data URL."));
      fr.readAsDataURL(blob);
    });

  /** Kirim hasil enhance (resolusi penuh) ke Auto Layout untuk lembar A4. */
  const forwardToLayout = withBusy("layout", async () => {
    const blob = await processFullRes();
    const base = fileName.replace(/\.[^.]+$/, "") || "enhanced-photo";
    setPendingLayoutPhoto(await blobToDataUrl(blob), `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  });

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
              <button
                type="button"
                className="btn btn-primary"
                onClick={download}
                disabled={busyOp !== null}
              >
                {busyOp === "download"
                  ? "⏳ Memproses…"
                  : "⬇️ Unduh PNG (ukuran penuh)"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={forwardToLayout}
                disabled={busyOp !== null}
              >
                {busyOp === "layout"
                  ? "⏳ Memproses…"
                  : "🧩 Susun ke Lembar A4"}
              </button>
            </div>
            {busyOp && (
              <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                ⏳ Memproses resolusi penuh di <strong>Web Worker</strong> — UI
                tetap responsif; hasilnya identik dengan jalur lama.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
