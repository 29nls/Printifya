import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FaceEnhanceParams } from "../../shared/facePipeline";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import { downloadUrl } from "../../shared/downloadUrl";
import {
  countFrames,
  formatEta,
  formatTimecode,
  DEFAULT_VIDEO_PARAMS,
  FPS_OPTIONS,
  FORMATS,
  FRAME_SAMPLING,
  RES_MODES,
  sampledFrames,
  type FrameSampling,
  type VideoEnhanceParams,
} from "./videoEnhance";
import { useWaveformAudio } from "./useWaveformAudio";
import { useSyncCompare } from "./useSyncCompare";
import { useVideoEnhanceRun, type VideoMeta } from "./useVideoEnhanceRun";
import {
  clearVideoOptions,
  loadVideoPrefs,
  saveVideoPrefs,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

const SLIDERS: {
  key: keyof FaceEnhanceParams;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "fidelity", label: "Fidelitas (w)", min: 0, max: 100 },
  { key: "smooth", label: "Pemulusan Kulit", min: 0, max: 100 },
  { key: "sharpen", label: "Ketajaman", min: 0, max: 100 },
  { key: "color", label: "Koreksi Warna", min: 0, max: 100 },
];

/** Teks tooltip waveform: durasi, puncak dB, jumlah kanal (untuk data-tip). */
function formatWaveTip(s: {
  duration: number;
  peakDb: number;
  channels: number;
} | null): string {
  if (!s) return "";
  const db =
    s.peakDb === -Infinity
      ? "−∞ dB"
      : `${Math.min(0, s.peakDb).toFixed(1)} dB`;
  return `Durasi ${s.duration.toFixed(1)} dtk · Puncak ${db} · ${s.channels} kanal`;
}

export default function VideoFaceEnhancePage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Semua opsi pipeline + awalan label — default dari localStorage (divalidasi).
  const [params, setParams] = useState<VideoEnhanceParams>(
    () => loadVideoPrefs().params
  );
  const [layoutPrefix, setLayoutPrefix] = useState(
    () => loadVideoPrefs().layoutPrefix
  );
  // null = belum diketahui, true/false = video sumber punya/tanpa audio.
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const wave = useWaveformAudio(videoUrl, hasAudio);
  const runCtl = useVideoEnhanceRun({
    meta,
    params,
    hasAudio,
    videoRef,
    audioCtxRef: wave.audioCtxRef,
    audioSharedRef: wave.audioSharedRef,
    ensureAudioBuffer: wave.ensureAudioBuffer,
    setError,
  });
  const sync = useSyncCompare(runCtl.resultUrl);

  // Persist semua opsi + awalan setiap berubah.
  useEffect(() => {
    saveVideoPrefs({ params, layoutPrefix });
  }, [params, layoutPrefix]);

  // URL sumber terbaru — dibaca saat unmount (cleanup di bawah), agar revoke
  // hanya terjadi saat komponen benar-benar dilepas, BUKAN saat videoUrl
  // berubah (cleanup lama ikut me-revoke blob sumber setiap kali hasil baru
  // dibuat — membuat run berikutnya kehilangan audio). Cleanup hasil/recorder/
  // worker dimiliki useVideoEnhanceRun; cleanup audio & sinkronisasi banding
  // dimiliki useWaveformAudio / useSyncCompare (ikut jalan saat unmount).
  const videoUrlRef = useRef(videoUrl);
  videoUrlRef.current = videoUrl;
  useEffect(() => {
    return () => {
      const vUrl = videoUrlRef.current;
      if (vUrl) URL.revokeObjectURL(vUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("File harus berupa video (MP4, WebM, atau format video lain).");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    const token = ++runCtl.fileTokenRef.current;
    video.onerror = () => {
      if (token !== runCtl.fileTokenRef.current) return;
      setError("Gagal membaca video.");
      URL.revokeObjectURL(url);
    };
    // Durasi WebM buatan MediaRecorder kadang baru terbaca belakangan
    // (Infinity saat loadedmetadata → finite setelah durationchange), jadi
    // polling hingga durasi valid (maks ~3 dtk) sebelum lanjut.
    const waitForDuration = (): Promise<number> =>
      new Promise((resolve) => {
        let tries = 0;
        const check = () => {
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            resolve(d);
            return;
          }
          if (++tries > 60) {
            resolve(0);
            return;
          }
          setTimeout(check, 50);
        };
        video.addEventListener("loadedmetadata", check, { once: true });
        check();
      });
    video.src = url;
    video.load();
    void waitForDuration().then((duration) => {
      if (token !== runCtl.fileTokenRef.current) {
        // file lain sudah dipilih — buang URL ini
        URL.revokeObjectURL(url);
        return;
      }
      if (duration <= 0) {
        setError("Durasi video tidak terbaca — coba format MP4/WebM.");
        URL.revokeObjectURL(url);
        return;
      }
      // Deteksi track audio: audioTracks (Safari/Edge), mozHasAudio (Firefox),
      // dan fallback captureStream() (Chrome tidak memaparkan audioTracks).
      const videoWithAudio = video as HTMLVideoElement & {
        audioTracks?: { length: number };
        mozHasAudio?: boolean;
        captureStream?: () => MediaStream;
      };
      let hasAudioTrack =
        (videoWithAudio.audioTracks?.length ?? 0) > 0 ||
        videoWithAudio.mozHasAudio === true;
      if (!hasAudioTrack && typeof videoWithAudio.captureStream === "function") {
        try {
          const s = videoWithAudio.captureStream();
          hasAudioTrack = s.getAudioTracks().length > 0;
          s.getTracks().forEach((t) => t.stop());
        } catch {
          // anggap tanpa audio
        }
      }
      setHasAudio(hasAudioTrack);
      setMeta({ w: video.videoWidth, h: video.videoHeight, duration });
      // Video baru → audio buffer/promise lama TIDAK berlaku (jangan diputar
      // ulang untuk video lain) — indikator waveform ikut di-reset dan akan
      // di-decode ulang oleh efek [videoUrl, hasAudio].
      wave.resetAudioForNewVideo();
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      runCtl.clearResult();
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const resetParams = () => {
    setParams({ ...DEFAULT_VIDEO_PARAMS });
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearVideoOptions();
    setParams({ ...DEFAULT_VIDEO_PARAMS });
    setLayoutPrefix("video-");
  };

  /** Ambil frame video hasil saat ini (posisi pemutaran pengguna) → data URL. */
  const captureResultFrame = (): Promise<string> => {
    const v = sync.resVideoRef.current;
    if (!v) return Promise.reject(new Error("Video hasil belum siap."));
    if (v.videoWidth === 0 || v.videoHeight === 0) {
      return Promise.reject(
        new Error("Frame video hasil belum tersaji — putar video dulu.")
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("Canvas 2D tidak tersedia."));
    ctx.drawImage(v, 0, 0);
    return Promise.resolve(canvas.toDataURL("image/png"));
  };

  /** Teruskan frame hasil ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = async () => {
    setError("");
    try {
      const dataUrl = await captureResultFrame();
      setPendingPasFoto(dataUrl);
      navigate("/photo-studio/pas-foto-3x4");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil frame hasil.");
    }
  };

  /** Kirim frame hasil ke Auto Layout (label memakai awalan modul ini). */
  const forwardToLayout = async () => {
    setError("");
    try {
      const dataUrl = await captureResultFrame();
      const base = fileName.replace(/\.[^.]+$/, "") || "video-face";
      setPendingLayoutPhoto(dataUrl, `${layoutPrefix}${base}`);
      navigate("/ai-assistant/auto-layout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil frame hasil.");
    }
  };

  const download = () => {
    if (!runCtl.resultUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "video-face";
    downloadUrl(
      runCtl.resultUrl,
      `${base}-face-restored.${runCtl.resultExt}`,
      { revoke: false }
    );
  };

  return (
    <div className="video-enhance-page">
      {/* Video sumber tersembunyi — dipakai untuk seek & drawImage frame. */}
      <video
        ref={videoRef}
        src={videoUrl ?? undefined}
        muted
        playsInline
        preload="auto"
        className="vfe-source"
      />
      <header className="module-header">
        <span className="module-icon">🎥</span>
        <div>
          <h1>Video Face Enhance</h1>
          <p>
            Pulihkan kualitas wajah pada video ala{" "}
            <code>kepengxu/PGTFormer</code> (IJCAI'24): tiap frame dianalisis
            (deteksi wajah per frame — parsing-guided), wajah dipulihkan lebih
            kuat dari latar, lalu hasil di-blend dengan frame sebelumnya untuk{" "}
            <strong>koherensi temporal tanpa pre-alignment</strong> — mengurangi
            kedipan antar frame. Output direkam sebagai video WebM/MP4 di
            browser. Tanpa model ML, semua proses lokal.
          </p>
        </div>
      </header>

      {!videoUrl && (
        <section className="panel">
          <div
            className={dragOver ? "upload-zone dragging" : "upload-zone"}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ")
                inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="upload-icon">🎬</div>
            <h3>Seret & letakkan video di sini</h3>
            <p>atau klik untuk memilih file — MP4, WebM, atau format video lain</p>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {error && <p className="error">{error}</p>}
          <p className="hint">
            💡 Mengikuti <code>PGTFormer</code> (Beyond Alignment: Blind Video
            Face Restoration via Parsing-Guided Temporal-Coherent Transformer):{" "}
            wajah dideteksi per frame (heuristik warna kulit), pemulihan
            difokuskan ke kotak wajah (parsing-guided), dan{" "}
            <strong>Koherensi Temporal</strong> menstabilkan wajah antar frame
            tanpa menyelaraskan pose (tanpa pre-alignment) — hasilnya video
            bebas kedipan, direkam langsung di browser.
          </p>
        </section>
      )}

      {videoUrl && meta && (
        <>
          <section className="panel">
            <div className="file-row">
              <span className="file-title">
                🎬 Video: <strong>{fileName}</strong>
                <span className="dims">
                  {" "}
                  — {meta.w} × {meta.h} px, {meta.duration.toFixed(1)} dtk
                  {hasAudio === true
                    ? " 🔊 audio"
                    : hasAudio === false
                      ? " 🔇 tanpa audio"
                      : ""}
                </span>
                {hasAudio === true && (
                  <span className="audio-wave">
                    {wave.audioStatus === "decoding" ? (
                      <span className="wave-note">⏳ membaca audio…</span>
                    ) : wave.audioStatus === "failed" ? (
                      <span
                        className="wave-note wave-fail"
                        title="Track audio ada, tapi gagal di-decode (format tak didukung atau terlalu besar) — hasil akan direkam tanpa suara."
                      >
                        ⚠️ audio tak terbaca
                      </span>
                    ) : wave.waveform ? (
                      <span
                        className="wave-wrap"
                        data-tip={formatWaveTip(wave.waveStats)}
                      >
                      <svg
                        ref={wave.waveSvgRef}
                        className={wave.wavePlaying ? "waveform playing" : "waveform"}
                        width={160}
                        height={24}
                        viewBox="0 0 160 24"
                        role="button"
                        tabIndex={0}
                        aria-label={
                          wave.wavePlaying
                            ? "Jeda audio sumber (klik untuk menghentikan)"
                            : "Putar audio sumber (klik untuk memutar, cek cepat)"
                        }
                        aria-pressed={wave.wavePlaying}
                        onClick={wave.toggleWaveAudio}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            wave.toggleWaveAudio();
                          }
                        }}
                      >
                        <title>
                          {wave.wavePlaying
                            ? "Memutar audio sumber — klik untuk menghentikan"
                            : "Klik untuk memutar audio sumber (cek cepat)"}
                          {wave.waveStats ? ` — ${formatWaveTip(wave.waveStats)}` : ""}
                        </title>
                        {Array.from(wave.waveform, (p, i) => {
                          const h = Math.max(1, Math.round(p * 20));
                          const y = (24 - h) / 2;
                          return (
                            <rect
                              key={i}
                              x={i}
                              y={y}
                              width={1}
                              height={h}
                              className="wave-bar"
                            />
                          );
                        })}
                      </svg>
                      </span>
                    ) : null}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setVideoUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setMeta(null);
                  setError("");
                  setHasAudio(null);
                  wave.resetAudioForNewVideo();
                  runCtl.clearResult();
                }}
              >
                🔄 Video Lain
              </button>
            </div>

            <div className="enhance-controls">
              <div className="enhance-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={runCtl.processing}
                  onClick={runCtl.run}
                >
                  {runCtl.processing
                    ? `Memproses… (${runCtl.progress?.done ?? 0}/${runCtl.progress?.total ?? 0})`
                    : "🚀 Pulihkan Video"}
                </button>
                {runCtl.processing && (
                  <button type="button" className="btn" onClick={runCtl.cancel}>
                    ✋ Batal
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={runCtl.processing}
                  onClick={resetParams}
                >
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
                  <span>🖼️ Perbaiki latar juga (background enhancement)</span>
                </label>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={params.restoreColor}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        restoreColor: e.target.checked,
                      }))
                    }
                  />
                  <span>🎨 Pulihkan warna video pudar / hitam-putih</span>
                </label>
                <label className="slider-row">
                  <span className="slider-label">
                    Koherensi Temporal
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={params.temporal}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, temporal: Number(e.target.value) }))
                    }
                    title="PGTFormer: seberapa kuat hasil frame di-blend dengan frame sebelumnya (kurangi kedipan)"
                  />
                  <span className="slider-value">{params.temporal}</span>
                </label>
              </div>

              <div className="video-options">
                <label>
                  FPS output
                  <select
                    className="tool-select"
                    value={params.fps}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, fps: Number(e.target.value) }))
                    }
                  >
                    {FPS_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ukuran proses
                  <select
                    className="tool-select"
                    value={params.resMode}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        resMode: e.target.value as VideoEnhanceParams["resMode"],
                      }))
                    }
                  >
                    {RES_MODES.map((m) => (
                      <option key={m} value={m}>
                        {m === "512"
                          ? "512 px (PGTFormer)"
                          : m === "720"
                            ? "720 px"
                            : "Asli"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Format video
                  <select
                    className="tool-select"
                    value={runCtl.effFormat}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        format: e.target.value as VideoEnhanceParams["format"],
                      }))
                    }
                  >
                    {FORMATS.map((f) => (
                      <option
                        key={f}
                        value={f}
                        disabled={f === "mp4" && !runCtl.mp4Supported}
                      >
                        {f.toUpperCase()}
                        {f === "mp4" && !runCtl.mp4Supported ? " (tak didukung)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  title="Proses sebagian frame untuk video panjang: tiap frame hasil ditahan beberapa slot output, jadi durasi & FPS tetap sama — hanya kehalusan gerak berkurang."
                >
                  Sampling frame
                  <select
                    className="tool-select"
                    value={params.frameSampling}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        frameSampling: e.target.value as FrameSampling,
                      }))
                    }
                  >
                    {FRAME_SAMPLING.map((s) => (
                      <option key={s} value={s}>
                        {s === "all"
                          ? "Semua (paling halus)"
                          : s === "half"
                            ? "Setengah (2× lebih cepat)"
                            : "Sepertiga (3× lebih cepat)"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {runCtl.processing && runCtl.progress && (
                <div className="vfe-progress">
                  <div className="vfe-progress-bar">
                    <div
                      className="vfe-progress-fill"
                      style={{
                        width: `${(runCtl.progress.done / runCtl.progress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <span>
                    Frame {runCtl.progress.done} / {runCtl.progress.total} (
                    {Math.round((runCtl.progress.done / runCtl.progress.total) * 100)}%)
                    {runCtl.progress.fps > 0 && (
                      <span className="vfe-speed">
                        {" "}
                        · {runCtl.progress.fps >= 10 ? Math.round(runCtl.progress.fps) : runCtl.progress.fps.toFixed(1)} fps
                        {runCtl.progress.etaSec > 0 && (
                          <> · sisa ~{formatEta(runCtl.progress.etaSec)}</>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
            <p className="hint">
              💡 PGTFormer beroperasi di resolusi 512 — pilih "512 px (PGTFormer)"
              untuk perilaku paling dekat dengan repo asli; 720 px/Asli
              menghasilkan video lebih tajam tapi lebih lambat. Frame yang
              diproses = durasi × FPS; turunkan FPS untuk video panjang.
              **Sampling frame** memproses setengah/sepertiga frame untuk video
              panjang (2×/3× lebih cepat): tiap frame hasil ditahan beberapa
              slot output, jadi durasi & FPS hasil tetap sama — hanya kehalusan
              gerak berkurang. Durasi hasil ≈ durasi sumber (frame diproses
              dulu, lalu direkam ulang pada jadwal FPS); untuk video sangat
              panjang perekaman berjalan langsung dan durasi bisa sedikit lebih
              panjang. Track audio sumber dipertahankan: audio di-decode sekali
              menjadi AudioBuffer lalu diputar ulang via WebAudio →
              MediaStreamDestination saat rekam — output tidak senyap bila video
              sumber punya suara. Mini waveform di samping badge 🔊 menunjukkan
              audio benar-benar terbaca (hasil decode); **klik waveform untuk
              memutar/jeda audio sumber** (cek cepat, tanpa membuka pemutar
              penuh — diputar via WebAudio, elemen video tidak disentuh); bila
              muncul "⚠️ audio tak terbaca", hasil direkam tanpa suara.
            </p>
          </section>

          <section className="panel">
            <div className="prefs-row">
              <label className="layout-prefix">
                🧩 Awalan label di lembar Auto Layout
                <input
                  type="text"
                  value={layoutPrefix}
                  placeholder="mis. video-"
                  onChange={(e) => setLayoutPrefix(e.target.value)}
                />
              </label>
              <ResetPreferencesButton
                title="Hapus semua opsi tersimpan modul ini (slider, FPS, resolusi, format, awalan)"
                onReset={handleResetPrefs}
              />
            </div>
          </section>

          {runCtl.resultUrl && (
            <section className="panel">
              <div className="bg-compare">
                <figure>
                  <figcaption>
                    Sebelum (video asli)
                    <span className="compare-time" ref={sync.srcTimeRef}>
                      0:00:00.0
                    </span>
                  </figcaption>
                  <video
                    ref={sync.srcVideoRef}
                    src={videoUrl}
                    controls
                    muted={sync.compareMuted}
                    className="bg-preview-img"
                    onTimeUpdate={() => {
                      if (sync.srcTimeRef.current) {
                        sync.srcTimeRef.current.textContent = formatTimecode(
                          sync.srcVideoRef.current?.currentTime ?? 0
                        );
                      }
                    }}
                  />
                </figure>
                <figure>
                  <figcaption>
                    Sesudah (face restored)
                    <span className="compare-time" ref={sync.resTimeRef}>
                      0:00:00.0
                    </span>
                  </figcaption>
                  <video
                    ref={sync.resVideoRef}
                    src={runCtl.resultUrl}
                    controls
                    muted={sync.compareMuted}
                    className="bg-preview-img"
                    onTimeUpdate={() => {
                      if (sync.resTimeRef.current) {
                        sync.resTimeRef.current.textContent = formatTimecode(
                          sync.resVideoRef.current?.currentTime ?? 0
                        );
                      }
                    }}
                  />
                </figure>
              </div>
              <div className="compare-controls">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={sync.playBothSync}
                  title="Putar video asli & hasil bersamaan dari awal, disinkronkan (perbandingan audio/video A/B)"
                >
                  ▶️ Putar Keduanya (Sinkron)
                </button>
                <button type="button" className="btn" onClick={sync.toggleMute}>
                  {sync.compareMuted ? "🔇 Suarakan" : "🔊 Bisukan"}
                </button>
                <button type="button" className="btn" onClick={sync.stopBoth}>
                  ⏹ Berhenti
                </button>
              </div>
              <p className="hint compare-hint">
                💡 Putar Keduanya menjalankan video asli & hasil dari detik 0
                secara sinkron — cocok untuk membandingkan audio sebelum/sesudah
                (hasil mempertahankan track audio sumber bila ada). Tombol
                Bisukan/Suarakan mengendalikan suara kedua pemutar sekaligus.
              </p>
              <p
                className={
                  runCtl.faceFrames > 0
                    ? "face-note face-found"
                    : "face-note face-miss"
                }
              >
                {runCtl.faceFrames > 0
                  ? `😀 Wajah terdeteksi di ${runCtl.faceFrames} dari ${sampledFrames(
                      countFrames(meta.duration, params.fps),
                      params.frameSampling
                    )} frame — pemulihan difokuskan ke area wajah per frame (parsing-guided) dengan koherensi temporal ${params.temporal}.`
                  : "😕 Wajah tidak terdeteksi di frame mana pun — koreksi warna & ketajaman ringan diterapkan ke seluruh frame."}
              </p>
              <p className="hint">
                💡 Geser/putar video hasil ke frame yang diinginkan, lalu klik
                tombol terusan untuk mengirim frame itu ke alur pas foto atau
                lembar Auto Layout.
              </p>
              <div className="result-actions">
                <button type="button" className="btn btn-primary" onClick={download}>
                  ⬇️ Unduh {runCtl.resultExt.toUpperCase()}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={forwardToPasFoto}
                >
                  🪪 Jadikan Pas Foto 3x4 (frame ini)
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={forwardToLayout}
                >
                  🧩 Susun ke Lembar A4 (frame ini)
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
