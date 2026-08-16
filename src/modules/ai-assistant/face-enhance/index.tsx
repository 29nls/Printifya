import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectFace, type FaceRegion } from "../../photo-studio/shared/faceDetect";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import SyncedPhotoCompare from "../../shared/SyncedPhotoCompare";
import {
  autoFaceParams,
  enhanceFace,
  NEUTRAL_PARAMS,
  type FaceEnhanceParams,
} from "./faceEnhance";
import type {
  FaceEnhanceWorkerRequestNoId,
  FaceEnhanceWorkerResponse,
} from "./faceEnhanceWorkerApi";
import { createWorkerClient } from "../../shared/createWorkerClient";
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
  /** Operasi full-res yang sedang berjalan (busy state — UI tetap responsif
   *  karena pipeline berjalan di Web Worker). */
  const [busyOp, setBusyOp] = useState<
    "download" | "pasfoto" | "layout" | null
  >(null);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Web Worker pipeline full-res (restore wajah + perbesaran 2×/4×) — foto
  // besar tidak membekukan UI; fallback thread utama bila browser tanpa Worker.
  const useWorker = typeof Worker !== "undefined";
  const faceWorkerClient = useMemo(
    () =>
      createWorkerClient<
        FaceEnhanceWorkerRequestNoId,
        FaceEnhanceWorkerResponse
      >({
        createWorker: () =>
          new Worker(new URL("./faceEnhance.worker.ts", import.meta.url), {
            type: "module",
          }),
        errorMessage: "Worker gagal memproses foto.",
      }),
    []
  );

  // Hentikan worker saat komponen dilepas: tolak permintaan tertunda, terminate.
  useEffect(() => {
    return () => faceWorkerClient.terminate();
  }, [faceWorkerClient]);

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

  /**
   * Proses resolusi penuh (restore + perbesaran 2×/4×) → Blob PNG. Jalur
   * worker: drawImage + getImageData di thread utama (ringan), lalu
   * `applyFaceEnhance` + `upscaleCanvas` + encode PNG (`convertToBlob`) semua
   * di Web Worker → hasil keluar sebagai Blob. Fallback: `enhanceFace` sinkron
   * + `toBlob` (jalur lama) bila browser tanpa Worker. Hasil identik dengan
   * jalur lama — `applyFaceEnhance` adalah sumber tunggal logika restore.
   */
  const processFullRes = async (): Promise<Blob> => {
    if (!img) throw new Error("Tidak ada foto.");
    if (!useWorker) {
      const canvas = enhanceFace(img, params, 0, upscale);
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("Gagal membuat PNG.")),
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
    const res = await faceWorkerClient.post(
      {
        type: "process",
        pixels: buffer,
        w: canvas.width,
        h: canvas.height,
        // Kotak wajah dihitung saat upload (`detectFace(image)`) — panggilan
        // yang sama dengan jalur lama, jadi hasil deteksi identik.
        face,
        params,
        upscale,
      },
      [buffer]
    );
    if (!res.ok) throw new Error(res.error);
    return res.blob;
  };

  /** Bungkus operasi full-res dengan busy state + guard anti-konkurensi. */
  const withBusy =
    (op: "download" | "pasfoto" | "layout", fn: () => Promise<void>) =>
    async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusyOp(op);
      setError("");
      try {
        await fn();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Gagal memproses foto."
        );
      } finally {
        busyRef.current = false;
        setBusyOp(null);
      }
    };

  const download = withBusy("download", async () => {
    // Urutan CodeFormer → Real-ESRGAN: restore dulu, lalu perbesar hasilnya.
    const blob = await processFullRes();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "face-enhanced.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });

  /** Blob hasil → data URL (modul tujuan memakai data URL: pas foto bahkan
   *  me-revoke object URL masuknya saat double-mount StrictMode, jadi blob
   *  URL tidak aman untuk bridge). Base64 via FileReader berjalan di luar
   *  thread utama (baca blob async) — jauh lebih ringan daripada
   *  `canvas.toDataURL` sinkron pada resolusi penuh. */
  const blobToDataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () =>
        reject(new Error("Gagal mengonversi hasil ke data URL."));
      fr.readAsDataURL(blob);
    });

  /** Teruskan hasil (sudah diperbesar) ke alur crop pas foto ukuran terpilih. */
  const forwardToPasFoto = (target: PasFotoTargetId) =>
    withBusy("pasfoto", async () => {
      const blob = await processFullRes();
      setPendingPasFoto(await blobToDataUrl(blob));
      const p = PAS_FOTO_TARGETS.find((s) => s.id === target);
      navigate(p?.path ?? "/photo-studio/pas-foto-3x4");
    })();

  /** Kirim hasil enhance (resolusi penuh, sudah diperbesar) ke Auto Layout. */
  const forwardToLayout = withBusy("layout", async () => {
    const blob = await processFullRes();
    const base = fileName.replace(/\.[^.]+$/, "") || "face-enhanced";
    setPendingLayoutPhoto(await blobToDataUrl(blob), `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  });

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
            <SyncedPhotoCompare
              before={{ label: "Sebelum (asli)", src: originalUrl }}
              after={{ label: "Sesudah (face enhance)", canvas: preview }}
            />

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
              <div className="pasfoto-forward">
                <select
                  className="tool-select"
                  value={pasTarget}
                  disabled={busyOp !== null}
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
                  disabled={busyOp !== null}
                >
                  {busyOp === "pasfoto"
                    ? "⏳ Memproses…"
                    : "🪪 Jadikan Pas Foto"}
                </button>
              </div>
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
            {error && <p className="error">{error}</p>}
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
