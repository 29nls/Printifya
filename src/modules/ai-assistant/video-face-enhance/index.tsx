import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { detectFace } from "../../photo-studio/shared/faceDetect";
import {
  computeFaceBox,
  computeStretch,
  enhancePixels,
  type FaceEnhanceParams,
} from "../face-enhance/faceEnhance";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import {
  countFrames,
  DEFAULT_VIDEO_PARAMS,
  FPS_OPTIONS,
  FORMATS,
  pickWorkingSize,
  RES_MODES,
  temporalBlend,
  type VideoEnhanceParams,
} from "./videoEnhance";
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

interface VideoMeta {
  w: number;
  h: number;
  duration: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Pindahkan video ke waktu `t`; resolve saat frame tersaji (atau timeout
 *  pengaman 250 ms — browser tertentu menolak seek saat di-clamp ke durasi). */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - t) < 0.005) {
      resolve();
      return;
    }
    const done = () => resolve();
    video.addEventListener("seeked", done, { once: true });
    video.currentTime = t;
    window.setTimeout(() => {
      video.removeEventListener("seeked", done);
      resolve();
    }, 250);
  });
}

/**
 * Buat AudioContext (dengan fallback webkit). Dipakai untuk decode audio
 * sumber menjadi AudioBuffer dan memutar ulang saat rekaman.
 */
function makeAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
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
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState<"webm" | "mp4">("webm");
  const [faceFrames, setFaceFrames] = useState(0);
  // null = belum diketahui, true/false = video sumber punya/tanpa audio.
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileTokenRef = useRef(0);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const cancelledRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Audio sumber: AudioContext + buffer PCM hasil decode (sekali per video).
  // Diputar ulang via BufferSource → MediaStreamDestination saat rekam —
  // elemen video TIDAK pernah diputar (hanya di-seek/di-draw), karena
  // memutar elemen video yang sudah pernah lewat WebAudio bisa membuat
  // drawImage berikutnya men-taint canvas (perilaku Chromium).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const navigate = useNavigate();

  // Persist semua opsi + awalan setiap berubah.
  useEffect(() => {
    saveVideoPrefs({ params, layoutPrefix });
  }, [params, layoutPrefix]);

  // URL terbaru sumber & hasil — dibaca saat unmount (cleanup di bawah),
  // agar revoke hanya terjadi saat komponen benar-benar dilepas, BUKAN saat
  // videoUrl/resultUrl berubah (cleanup lama ikut me-revoke blob sumber setiap
  // kali hasil baru dibuat — membuat run berikutnya kehilangan audio).
  const urlsRef = useRef({ videoUrl, resultUrl });
  urlsRef.current = { videoUrl, resultUrl };
  // Bersihkan object URL + stop perekam + tutup AudioContext saat komponen dilepas.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        // abaikan
      }
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          // abaikan
        }
        audioCtxRef.current = null;
        audioBufferRef.current = null;
      }
      const { videoUrl: vUrl, resultUrl: rUrl } = urlsRef.current;
      if (vUrl) URL.revokeObjectURL(vUrl);
      if (rUrl) URL.revokeObjectURL(rUrl);
    };
  }, []);

  const mp4Supported =
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("video/mp4");
  // Format efektif: MP4 hanya bila didukung browser.
  const effFormat: "webm" | "mp4" =
    params.format === "mp4" && mp4Supported ? "mp4" : "webm";

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
    const token = ++fileTokenRef.current;
    video.onerror = () => {
      if (token !== fileTokenRef.current) return;
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
      if (token !== fileTokenRef.current) {
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
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setProgress(null);
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

  /** Proses seluruh video frame per frame → rekam ke WebM/MP4 via MediaRecorder.
   *  Dua fase agar durasi hasil ≈ durasi sumber: (1) semua frame diproses ke
   *  buffer (tanpa merekam), lalu (2) buffer di-putImageData ke canvas yang
   *  direkam pada jadwal fps yang tepat — putImageData jauh lebih cepat daripada
   *  drawImage+enhance, jadi fase rekam selalu mengikuti jadwal. Untuk video
   *  sangat panjang (frame > ~180 MB) fallback ke rekaman live waktu-nyata. */
  const run = async () => {
    const video = videoRef.current;
    if (!video || !meta || processing) return;
    setError("");
    const { w, h } = pickWorkingSize(meta.w, meta.h, params.resMode);
    const total = countFrames(meta.duration, params.fps);
    if (total <= 0) {
      setError("Durasi video tidak valid.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("Browser tidak mendukung perekaman video (MediaRecorder).");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setError("Canvas 2D tidak tersedia.");
      return;
    }
    if (!("captureStream" in canvas)) {
      setError("Browser tidak mendukung perekaman canvas (captureStream).");
      return;
    }
    const mime = effFormat === "mp4" ? "video/mp4" : "video/webm";
    // --- Audio sumber (WebAudio → MediaStreamDestination) ---
    // Context dibuat/resume DALAM gestur klik. Audio sumber di-decode sekali
    // menjadi AudioBuffer lalu diputar ulang via BufferSource saat rekam —
    // output tidak senyap, tanpa memutar elemen video (hindari taint canvas).
    if (hasAudio && !audioCtxRef.current) {
      audioCtxRef.current = makeAudioContext();
    }
    void audioCtxRef.current?.resume();
    // Decode audio sumber (sekali; hasil di-cache lintas run).
    let audioBuffer: AudioBuffer | null = audioBufferRef.current;
    if (hasAudio && !audioBuffer && audioCtxRef.current && videoUrl) {
      try {
        const raw = await (await fetch(videoUrl)).arrayBuffer();
        const decoded = await audioCtxRef.current.decodeAudioData(raw.slice(0));
        // Batas memori wajar (float32 × kanal × sampel) — video ultra-panjang
        // direkam tanpa audio daripada memakai ratusan MB RAM.
        const bytes =
          decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
        audioBuffer = bytes <= 100 * 1024 * 1024 ? decoded : null;
        audioBufferRef.current = audioBuffer;
      } catch {
        // decode gagal (format tak didukung) — rekam tanpa audio
        audioBuffer = null;
      }
    }
    const makeRecorder = (audioTracks: MediaStreamTrack[]) => {
      const canvasStream = (canvas as HTMLCanvasElement & {
        captureStream: (fps?: number) => MediaStream;
      }).captureStream(params.fps);
      const withAudio =
        audioTracks.length > 0
          ? new MediaStream([
              ...canvasStream.getVideoTracks(),
              ...audioTracks,
            ])
          : null;
      let rec: MediaRecorder;
      let stream: MediaStream;
      try {
        // Coba dengan audio; bila muxing audio+video tak didukung untuk mime
        // ini (mis. mp4 di browser tertentu), MediaRecorder melempar — ulangi
        // dengan video saja agar perekaman tetap berjalan.
        stream = withAudio ?? canvasStream;
        rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 8_000_000,
        });
      } catch {
        stream = canvasStream;
        rec = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: 8_000_000,
        });
      }
      recorderRef.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
      });
      rec.start();
      return { stream, rec, chunks, stopped };
    };

    const frameBytes = w * h * 4;
    const canPrerender = total * frameBytes <= 180 * 1024 * 1024;
    cancelledRef.current = false;
    setProcessing(true);
    setProgress({ done: 0, total });
    let prev: Uint8ClampedArray | null = null;
    let faceCount = 0;

    /** Proses satu frame: seek → draw → pipeline → koherensi temporal. */
    const processOne = async (i: number): Promise<Uint8ClampedArray | null> => {
      if (cancelledRef.current) return null;
      const t = Math.min(meta.duration, i / params.fps);
      await seekTo(video, t);
      if (cancelledRef.current) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      // Parsing-guided: wajah dideteksi per frame, kotak wajah dipulihkan
      // lebih kuat; tanpa wajah → koreksi global lembut.
      const face = detectFace(canvas);
      const box = computeFaceBox(face, w, h);
      const stretch = computeStretch(
        img.data,
        w,
        box ?? { x0: 0, y0: 0, x1: w, y1: h }
      );
      const out = enhancePixels(img.data, w, h, box, params, stretch);
      temporalBlend(out, prev, w, h, box, params.temporal);
      prev = out;
      if (box) faceCount++;
      return out;
    };

    let recorder: ReturnType<typeof makeRecorder> | null = null;
    try {
      if (canPrerender) {
        // Fase 1: proses semua frame ke buffer (recorder BELUM mulai — tidak
        // ada kanvas kosong yang ikut terekam).
        const buffers: Uint8ClampedArray[] = [];
        for (let i = 0; i < total; i++) {
          if (cancelledRef.current) break;
          const out = await processOne(i);
          if (out) buffers.push(out);
          setProgress({ done: i + 1, total });
          if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
        // Fase 2: mulai rekam, lalu putImageData buffer pada jadwal fps yang
        // tepat (putImageData jauh lebih cepat daripada drawImage+enhance,
        // jadi fase ini selalu mengikuti waktu nyata → durasi ≈ sumber).
        // Audio diputar ulang dari buffer via BufferSource → destination agar
        // track audio asli mengalir ke recorder (video sumber tetap pause).
        if (!cancelledRef.current && buffers.length === total) {
          let audioTracks: MediaStreamTrack[] = [];
          let srcNode: AudioBufferSourceNode | null = null;
          if (audioCtxRef.current && audioBuffer) {
            try {
              const dest = new MediaStreamAudioDestinationNode(audioCtxRef.current);
              srcNode = audioCtxRef.current.createBufferSource();
              srcNode.buffer = audioBuffer;
              srcNode.connect(dest);
              srcNode.start();
              audioTracks = dest.stream.getAudioTracks();
            } catch {
              // gagal — rekam tanpa audio
            }
          }
          recorder = makeRecorder(audioTracks);
          const t0 = performance.now();
          const interval = 1000 / params.fps;
          for (let i = 0; i < total; i++) {
            if (cancelledRef.current) break;
            const wait = t0 + i * interval - performance.now();
            if (wait > 1) await sleep(wait);
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(buffers[i]), w, h),
              0,
              0
            );
            if (i % 5 === 4 || i === total - 1) {
              setProgress({ done: i + 1, total });
            }
          }
          try {
            srcNode?.stop();
          } catch {
            // abaikan
          }
        }
      } else {
        // Video panjang: rekam live sambil proses (bila pemrosesan lebih
        // lambat dari fps, durasi output bisa lebih panjang — dijelaskan di UI).
        let audioTracks: MediaStreamTrack[] = [];
        let srcNode: AudioBufferSourceNode | null = null;
        if (audioCtxRef.current && audioBuffer) {
          try {
            const dest = new MediaStreamAudioDestinationNode(audioCtxRef.current);
            srcNode = audioCtxRef.current.createBufferSource();
            srcNode.buffer = audioBuffer;
            srcNode.connect(dest);
            srcNode.start();
            audioTracks = dest.stream.getAudioTracks();
          } catch {
            // gagal — rekam tanpa audio
          }
        }
        recorder = makeRecorder(audioTracks);
        const t0 = performance.now();
        const interval = 1000 / params.fps;
        for (let i = 0; i < total; i++) {
          if (cancelledRef.current) break;
          const wait = t0 + i * interval - performance.now();
          if (wait > 1) await sleep(wait);
          const out = await processOne(i);
          if (!out) break;
          ctx.putImageData(
            new ImageData(new Uint8ClampedArray(out), w, h),
            0,
            0
          );
          setProgress({ done: i + 1, total });
        }
        try {
          srcNode?.stop();
        } catch {
          // abaikan
        }
      }
    } catch (e) {
      // Error tak terduga (mis. canvas tainted oleh data lintas-origin) —
      // jangan biarkan UI macet di "Memproses…"; tampilkan pesan dan
      // kembalikan tombol ke kondisi semula (state di-reset di bawah).
      setError(
        e instanceof Error
          ? e.message
          : "Gagal memproses video (error tak dikenal)."
      );
    } finally {
      // Pulihkan elemen sumber (pause + mute) setelah rekam selesai/dibatalkan.
      try {
        video.pause();
        video.muted = true;
      } catch {
        // abaikan
      }
      if (recorder) {
        try {
          recorder.rec.stop();
        } catch {
          // recorder sudah berhenti
        }
        await recorder.stopped;
        recorder.stream.getTracks().forEach((tr) => tr.stop());
        recorderRef.current = null;
      }
    }
    if (cancelledRef.current || !recorder) {
      // dibatalkan / recorder tidak pernah mulai — buang hasil parsial
      setProcessing(false);
      setProgress(null);
      return;
    }
    const blob = new Blob(recorder.chunks, { type: mime });
    const url = URL.createObjectURL(blob);
    setResultUrl((prevUrl) => {
      if (prevUrl) URL.revokeObjectURL(prevUrl);
      return url;
    });
    setResultExt(effFormat);
    setFaceFrames(faceCount);
    setProcessing(false);
    setProgress(null);
  };

  /** Hentikan batch: frame yang sedang berjalan diselesaikan, sisanya berhenti. */
  const cancel = () => {
    cancelledRef.current = true;
  };

  /** Ambil frame video hasil saat ini (posisi pemutaran pengguna) → data URL. */
  const captureResultFrame = (): Promise<string> => {
    const v = resultVideoRef.current;
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
    if (!resultUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "video-face";
    const a = document.createElement("a");
    a.href = resultUrl;
    a.download = `${base}-face-restored.${resultExt}`;
    a.click();
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
              <span>
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
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setVideoUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setResultUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setMeta(null);
                  setProgress(null);
                  setError("");
                  setHasAudio(null);
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
                  disabled={processing}
                  onClick={run}
                >
                  {processing ? `Memproses… (${progress?.done ?? 0}/${progress?.total ?? 0})` : "🚀 Pulihkan Video"}
                </button>
                {processing && (
                  <button type="button" className="btn" onClick={cancel}>
                    ✋ Batal
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  disabled={processing}
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
                    value={effFormat}
                    onChange={(e) =>
                      setParams((p) => ({
                        ...p,
                        format: e.target.value as VideoEnhanceParams["format"],
                      }))
                    }
                  >
                    {FORMATS.map((f) => (
                      <option key={f} value={f} disabled={f === "mp4" && !mp4Supported}>
                        {f.toUpperCase()}
                        {f === "mp4" && !mp4Supported ? " (tak didukung)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {processing && progress && (
                <div className="vfe-progress">
                  <div className="vfe-progress-bar">
                    <div
                      className="vfe-progress-fill"
                      style={{
                        width: `${(progress.done / progress.total) * 100}%`,
                      }}
                    />
                  </div>
                  <span>
                    Frame {progress.done} / {progress.total} (
                    {Math.round((progress.done / progress.total) * 100)}%)
                  </span>
                </div>
              )}
            </div>
            <p className="hint">
              💡 PGTFormer beroperasi di resolusi 512 — pilih "512 px (PGTFormer)"
              untuk perilaku paling dekat dengan repo asli; 720 px/Asli
              menghasilkan video lebih tajam tapi lebih lambat. Frame yang
              diproses = durasi × FPS; turunkan FPS untuk video panjang. Durasi
              hasil ≈ durasi sumber (frame diproses dulu, lalu direkam ulang
              pada jadwal FPS); untuk video sangat panjang perekaman berjalan
              langsung dan durasi bisa sedikit lebih panjang. Track audio sumber
              dipertahankan: audio di-decode sekali menjadi AudioBuffer lalu
              diputar ulang via WebAudio → MediaStreamDestination saat rekam —
              output tidak senyap bila video sumber punya suara.
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

          {resultUrl && (
            <section className="panel">
              <div className="bg-compare">
                <figure>
                  <figcaption>Sebelum (video asli)</figcaption>
                  <video
                    src={videoUrl}
                    controls
                    className="bg-preview-img"
                  />
                </figure>
                <figure>
                  <figcaption>Sesudah (face restored)</figcaption>
                  <video
                    ref={resultVideoRef}
                    src={resultUrl}
                    controls
                    className="bg-preview-img"
                  />
                </figure>
              </div>
              <p
                className={
                  faceFrames > 0 ? "face-note face-found" : "face-note face-miss"
                }
              >
                {faceFrames > 0
                  ? `😀 Wajah terdeteksi di ${faceFrames} dari ${countFrames(
                      meta.duration,
                      params.fps
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
                  ⬇️ Unduh {resultExt.toUpperCase()}
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
