import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectFace, type FaceRegion } from "../../photo-studio/shared/faceDetect";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import {
  autoFaceParams,
  enhanceFace,
  NEUTRAL_PARAMS,
  type FaceEnhanceParams,
} from "./faceEnhance";
import {
  clearFaceEnhanceOptions,
  loadLayoutPrefix,
  loadUpscale,
  saveLayoutPrefix,
  saveUpscale,
} from "./optionsStorage";
import { comparePipelines, type CompareResult } from "./qualityCompare";
import { pickWorkingSize, type VideoEnhanceParams } from "../video-face-enhance/videoEnhance";
import { loadVideoPrefs } from "../video-face-enhance/optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

const PREVIEW_MAX = 1200; // px — sisi terpanjang pratinjau live

/** Batas sisi terpanjang perbandingan kualitas saat resolusi kerja video "asli"
 *  (video besar diproses di resolusi kerja lebih kecil; di sini dibatasi agar
 *  tombol perbandingan tetap responsif pada foto sangat besar). */
const COMPARE_MAX = 1600;

const UPSCALE_OPTIONS = [1, 2, 4] as const;

/** Ukuran pas foto tujuan terusan (pola diagram: crop 2×3 / 3×4 / 4×6). */
const PAS_FOTO_TARGETS = [
  { id: "2x3", label: "2×3", path: "/photo-studio/pas-foto-2x3" },
  { id: "3x4", label: "3×4", path: "/photo-studio/pas-foto-3x4" },
  { id: "4x6", label: "4×6", path: "/photo-studio/pas-foto-4x6" },
] as const;

type PasFotoTargetId = (typeof PAS_FOTO_TARGETS)[number]["id"];

const SLIDERS: {
  key: keyof FaceEnhanceParams;
  label: string;
  min: number;
  max: number;
  unit: string;
}[] = [
  {
    key: "fidelity",
    label: "Fidelitas (w)",
    min: 0,
    max: 100,
    unit: "",
  },
  { key: "smooth", label: "Pemulusan Kulit", min: 0, max: 100, unit: "" },
  { key: "sharpen", label: "Ketajaman", min: 0, max: 100, unit: "" },
  { key: "color", label: "Koreksi Warna", min: 0, max: 100, unit: "" },
];

export default function FaceEnhancePage() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [params, setParams] = useState<FaceEnhanceParams>(NEUTRAL_PARAMS);
  const [preview, setPreview] = useState<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [face, setFace] = useState<FaceRegion | null>(null);
  const [autoApplied, setAutoApplied] = useState(false);
  /** Awalan nama default saat hasil dikirim ke Auto Layout (label lembar). */
  const [layoutPrefix, setLayoutPrefix] = useState(loadLayoutPrefix);
  /** Perbesaran setelah pemulihan (CodeFormer → Real-ESRGAN), default 2. */
  const [upscale, setUpscale] = useState<number>(() => loadUpscale());
  /** Ukuran pas foto tujuan terusan (default 3×4). */
  const [pasTarget, setPasTarget] = useState<PasFotoTargetId>("3x4");
  /** Hasil perbandingan kualitas Face Enhance vs Video Face Enhance. */
  const [comparing, setComparing] = useState(false);
  const [compare, setCompare] = useState<{
    result: CompareResult;
    resMode: VideoEnhanceParams["resMode"];
    videoParams: VideoEnhanceParams;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Metrik perbandingan (local const agar narrowing TS berlaku di JSX).
  const compareMetrics = compare?.result.metrics ?? null;

  useEffect(() => {
    saveLayoutPrefix(layoutPrefix);
  }, [layoutPrefix]);

  useEffect(() => {
    saveUpscale(upscale);
  }, [upscale]);

  // Pratinjau live dengan debounce singkat saat slider digeser.
  useEffect(() => {
    if (!img) return;
    const t = setTimeout(() => {
      try {
        setPreview(enhanceFace(img, params, PREVIEW_MAX));
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
      setFace(detectFace(image));
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

  /** Analisis kotak wajah (histogram + saturasi) lalu set slider yang disarankan. */
  const autoEnhance = () => {
    if (!img) return;
    setParams(autoFaceParams(img));
    setAutoApplied(true);
  };

  const reset = () => {
    setParams(NEUTRAL_PARAMS);
    setUpscale(2);
    setAutoApplied(false);
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearFaceEnhanceOptions();
    setLayoutPrefix("face-");
    setUpscale(2);
  };

  const download = () => {
    if (!img) return;
    // Urutan CodeFormer → Real-ESRGAN: restore dulu, lalu perbesar hasilnya.
    const full = enhanceFace(img, params, 0, upscale);
    const a = document.createElement("a");
    a.href = full.toDataURL("image/png");
    a.download = "face-enhanced.png";
    a.click();
  };

  /** Teruskan hasil (sudah diperbesar) ke alur crop pas foto ukuran terpilih. */
  const forwardToPasFoto = (target: PasFotoTargetId) => {
    if (!img) return;
    const full = enhanceFace(img, params, 0, upscale);
    setPendingPasFoto(full.toDataURL("image/png"));
    const p = PAS_FOTO_TARGETS.find((s) => s.id === target);
    navigate(p?.path ?? "/photo-studio/pas-foto-3x4");
  };

  /** Kirim hasil enhance (resolusi penuh, sudah diperbesar) ke Auto Layout. */
  const forwardToLayout = () => {
    if (!img) return;
    const full = enhanceFace(img, params, 0, upscale);
    const base = fileName.replace(/\.[^.]+$/, "") || "face-enhanced";
    setPendingLayoutPhoto(full.toDataURL("image/png"), `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  };

  /**
   * Bandingkan kualitas Face Enhance vs Video Face Enhance pada frame foto
   * yang sama: kedua pipeline dijalankan di resolusi kerja video (`resMode`
   * tersimpan modul video), lalu PSNR + diff dihitung antar hasil. Dijalankan
   * di luar paint (setTimeout) agar tombol sempat menampilkan "Membandingkan…".
   */
  const runCompare = () => {
    if (!img) return;
    setError("");
    setComparing(true);
    setCompare(null);
    window.setTimeout(() => {
      try {
        const videoPrefs = loadVideoPrefs();
        const resMode = videoPrefs.params.resMode;
        let { w, h } = pickWorkingSize(
          img.naturalWidth,
          img.naturalHeight,
          resMode
        );
        const longSide = Math.max(w, h);
        if (longSide > COMPARE_MAX) {
          const s = COMPARE_MAX / longSide;
          w = Math.max(2, Math.round((w * s) / 2) * 2);
          h = Math.max(2, Math.round((h * s) / 2) * 2);
        }
        const result = comparePipelines(img, params, videoPrefs.params, w, h);
        setCompare({ result, resMode, videoParams: videoPrefs.params });
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Gagal membandingkan pipeline."
        );
      } finally {
        setComparing(false);
      }
    }, 20);
  };

  /** Salin kanvas hasil ke elemen <canvas> tampilan (pola pratinjau live). */
  const drawCompareCanvas =
    (src: HTMLCanvasElement | null) =>
    (el: HTMLCanvasElement | null) => {
      if (el && src) {
        el.width = src.width;
        el.height = src.height;
        el.getContext("2d")?.drawImage(src, 0, 0);
      }
    };

  return (
    <div className="face-enhance-page">
      <header className="module-header">
        <span className="module-icon">👤</span>
        <div>
          <h1>Face Enhance</h1>
          <p>
            Pulihkan kualitas wajah ala <code>sczhou/CodeFormer</code>: deteksi
            wajah, lalu pemulusan kulit, koreksi warna, dan ketajaman difokuskan
            ke area wajah — dengan slider fidelitas <code>w</code>, perbaikan
            latar opsional, dan pemulihan warna foto lama. Tanpa model ML,
            semua proses lokal di browser.
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
            💡 Mengikuti <code>CodeFormer</code>: wajah terdeteksi (heuristik
            warna kulit), lalu efek pemulihan diterapkan di dalam kotak wajah
            dengan kekuatan yang diatur oleh <strong>fidelitas w</strong> —{" "}
            <strong>100</strong> = pertahankan foto asli, <strong>0</strong> =
            pemulihan terkuat. <strong>Pemulihan Warna</strong> menyala otomatis
            untuk foto hitam-putih/pudar. Urutan pipeline seperti CodeFormer +
            Real-ESRGAN: <strong>pemulihan wajah dulu, perbesaran kemudian</strong>{" "}
            (2×/4×) — memperbesar dulu hanya membesarkan piksel rusak, informasi
            wajah yang hilang tidak kembali dengan sendirinya.
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
                    {upscale > 1 && (
                      <>
                        {" "}
                        → hasil {dims.w * upscale} × {dims.h * upscale} px (
                        {upscale}× setelah pemulihan)
                      </>
                    )}
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
                  setFace(null);
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
                  ✨ Auto Setel
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
                      value={params[s.key] as number}
                      onChange={(e) =>
                        setParams((p) => ({
                          ...p,
                          [s.key]: Number(e.target.value),
                        }))
                      }
                    />
                    <span className="slider-value">
                      {params[s.key] as number}
                      {s.unit}
                    </span>
                  </label>
                ))}
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={params.background}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, background: e.target.checked }))
                    }
                  />
                  <span>🖼️ Perbaiki latar juga (CodeFormer: background enhancement)</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={params.restoreColor}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, restoreColor: e.target.checked }))
                    }
                  />
                  <span>🎨 Pulihkan warna foto pudar / hitam-putih</span>
                </label>
                <label className="slider-row">
                  <span className="slider-label">Perbesaran (Real-ESRGAN)</span>
                  <select
                    className="tool-select"
                    value={upscale}
                    title="Diterapkan SETELAH pemulihan wajah (urutan CodeFormer → Real-ESRGAN)"
                    onChange={(e) => setUpscale(Number(e.target.value))}
                  >
                    {UPSCALE_OPTIONS.map((u) => (
                      <option key={u} value={u}>
                        {u}×
                      </option>
                    ))}
                  </select>
                  <span className="slider-value">{upscale}×</span>
                </label>
              </div>

              {face ? (
                <p className="face-note face-found">
                  😀 Wajah terdeteksi di {(face.x * 100).toFixed(0)}%,
                  {(face.y * 100).toFixed(0)}% — pemulihan difokuskan ke area
                  wajah{params.background ? " + latar" : ""}.
                </p>
              ) : (
                <p className="face-note face-miss">
                  😕 Wajah tidak terdeteksi — koreksi warna & ketajaman ringan
                  diterapkan ke seluruh foto.
                </p>
              )}

              {autoApplied && (
                <p className="auto-note">
                  ✨ Auto diterapkan — geser slider untuk penyesuaian halus.
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="bg-compare">
              <figure>
                <figcaption>Sebelum (asli)</figcaption>
                <img src={originalUrl} alt="Foto asli" className="bg-preview-img" />
              </figure>
              <figure>
                <figcaption>Sesudah (face enhance)</figcaption>
                {preview && (
                  <canvas
                    className="bg-preview-img"
                    width={preview.width}
                    height={preview.height}
                    ref={(el) => {
                      if (el) {
                        const ctx = el.getContext("2d");
                        ctx?.drawImage(preview, 0, 0);
                      }
                    }}
                  />
                )}
              </figure>
            </div>

            <div className="prefs-row">
              <label className="layout-prefix">
                🧩 Awalan label di lembar Auto Layout
                <input
                  type="text"
                  value={layoutPrefix}
                  placeholder="mis. face-"
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
              <div className="pasfoto-forward">
                <select
                  className="tool-select"
                  value={pasTarget}
                  title="Ukuran pas foto tujuan — hasil enhance + perbesaran diteruskan ke alur crop"
                  onChange={(e) => setPasTarget(e.target.value as PasFotoTargetId)}
                >
                  {PAS_FOTO_TARGETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => forwardToPasFoto(pasTarget)}
                >
                  🪪 Jadikan Pas Foto
                </button>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={forwardToLayout}
              >
                🧩 Susun ke Lembar A4
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="compare-header">
              <div>
                <h3>⚖️ Perbandingan Kualitas: Face Enhance vs Video Face Enhance</h3>
                <p className="hint" style={{ marginTop: 4, marginBottom: 0 }}>
                  Jalankan kedua pipeline pada frame foto yang sama lalu lihat
                  metrik perbedaan (PSNR/diff).
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={comparing}
                onClick={runCompare}
              >
                {comparing ? "⏳ Membandingkan…" : "🔬 Bandingkan pada frame ini"}
              </button>
            </div>

            {compare && (
              <>
                {compareMetrics ? (
                  <div className="compare-metrics">
                    <div className="metric metric-psnr">
                      <span className="metric-label">PSNR</span>
                      <span className="metric-value">
                        {compareMetrics.psnr == null
                          ? "—"
                          : compareMetrics.psnr === Infinity
                            ? "∞ dB — identik"
                            : `${compareMetrics.psnr.toFixed(1)} dB`}
                      </span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Δ rata-rata</span>
                      <span className="metric-value">
                        {compareMetrics.meanAbsDiff.toFixed(2)} / 255
                      </span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Δ maks</span>
                      <span className="metric-value">
                        {compareMetrics.maxDiff} / 255
                      </span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Piksel berubah (&gt;8)</span>
                      <span className="metric-value">
                        {compareMetrics.pctChanged.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="error">
                    Dimensi hasil berbeda — PSNR tidak dapat dihitung.
                  </p>
                )}

                <div className="bg-compare">
                  <figure>
                    <figcaption>
                      Face Enhance (CodeFormer) —{" "}
                      {compare.result.face.canvas.width}×
                      {compare.result.face.canvas.height} px · wajah{" "}
                      {compare.result.face.faceDetected
                        ? "ditemukan"
                        : "tidak ditemukan"}
                    </figcaption>
                    <canvas
                      className="bg-preview-img"
                      ref={drawCompareCanvas(compare.result.face.canvas)}
                    />
                  </figure>
                  <figure>
                    <figcaption>
                      Video Face Enhance (PGTFormer) —{" "}
                      {compare.result.video.canvas.width}×
                      {compare.result.video.canvas.height} px · temporal{" "}
                      {compare.videoParams.temporal} · resolusi kerja{" "}
                      {compare.resMode}
                    </figcaption>
                    <canvas
                      className="bg-preview-img"
                      ref={drawCompareCanvas(compare.result.video.canvas)}
                    />
                  </figure>
                </div>

                <p className="hint">
                  {compareMetrics?.psnr === Infinity
                    ? "Hasil identik: kedua modul memakai inti pipeline yang sama per frame (deteksi wajah → pemulihan di kotak wajah), dan pada foto diam koherensi temporal video bersifat identitas. Perbedaan muncul bila parameter tiap modul disetel berbeda."
                    : `Perbedaan berasal dari parameter tersimpan tiap modul (video memakai slider video-nya sendiri, mis. fidelitas ${compare.videoParams.fidelity}, temporal ${compare.videoParams.temporal}) dan resolusi kerja video (${compare.resMode}). Keduanya memakai inti pipeline yang sama; koherensi temporal hanya aktif antar frame video.`}
                </p>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
