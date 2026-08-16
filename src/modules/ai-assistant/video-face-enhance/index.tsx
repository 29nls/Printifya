import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type FaceEnhanceParams } from "../face-enhance/faceEnhance";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import {
  computePeaks,
  computeWaveStats,
  countFrames,
  createSharedAudioState,
  formatTimecode,
  DEFAULT_VIDEO_PARAMS,
  FPS_OPTIONS,
  FORMATS,
  FRAME_SAMPLING,
  pickWorkingSize,
  processFramePixels,
  resolveSharedAudioBuffer,
  RES_MODES,
  sampledBufferIndex,
  sampledFrames,
  samplingFactor,
  type FrameSampling,
  type SharedAudioState,
  type VideoEnhanceParams,
} from "./videoEnhance";
import type {
  FaceWorkerRequestNoId,
  FaceWorkerResponse,
} from "./faceWorkerApi";
import { createWorkerClient } from "../../shared/createWorkerClient";
import {
  clearVideoOptions,
  loadVideoPrefs,
  saveVideoPrefs,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import {
  recordWithAudio,
  type AudioRecorder,
} from "../../shared/recordWithAudio";
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
 * Buat AudioContext (dengan fallback webkit). Dipakai untuk memutar ulang
 * audio saat rekaman (dibuat/resume DALAM gestur klik).
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

/** Batas memori wajar untuk AudioBuffer (float32 × kanal × sampel) — video
 *  ultra-panjang direkam tanpa audio daripada memakai ratusan MB RAM. */
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/**
 * Decode audio menjadi AudioBuffer via OfflineAudioContext — bukan context
 * playback: tidak perlu resume/gestur, tanpa warning autoplay, dan bisa
 * dipanggil segera setelah video dipilih (untuk indikator waveform). Hasil
 * AudioBuffer bersifat independen dari context dan bisa diputar ulang oleh
 * context playback mana pun. `null` bila tak didukung / decode gagal.
 */
function decodeAudioBuffer(arrayBuf: ArrayBuffer): Promise<AudioBuffer | null> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
    }).webkitOfflineAudioContext;
  if (!Ctor) return Promise.resolve(null);
  try {
    const ctx = new Ctor(1, 1, 44100);
    return ctx
      .decodeAudioData(arrayBuf.slice(0))
      .then((b) => b as AudioBuffer)
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
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
  // Bisukan kedua pemutar banding (tombol mute eksplisit) — default suara
  // menyala karena pemutaran dipicu gestur klik (autoplay diizinkan).
  const [compareMuted, setCompareMuted] = useState(false);
  // Status decode audio untuk indikator waveform: idle/decoding/ready/failed.
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "decoding" | "ready" | "failed"
  >("idle");
  // Puncak waveform audio sumber (0..1 per bucket) — SVG mini di samping badge.
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  // Statistik ringkas untuk tooltip waveform (durasi, puncak dB, jumlah kanal).
  const [waveStats, setWaveStats] = useState<{
    duration: number;
    peakDb: number;
    channels: number;
  } | null>(null);
  // Pemutaran audio sumber untuk cek cepat (klik waveform): diputar via
  // BufferSource → context.destination — elemen video TIDAK pernah diputar
  // (menjaga drawImage agar tidak men-taint canvas).
  const [wavePlaying, setWavePlaying] = useState(false);
  const waveSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileTokenRef = useRef(0);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  // Video sumber di panel banding sebelum/sesudah (elemen TERPISAH dari
  // videoRef tersembunyi — yang TIDAK boleh diputar agar drawImage tidak
  // men-taint canvas).
  const srcVideoRef = useRef<HTMLVideoElement>(null);
  // Span timecode di atas tiap video banding — ditulis langsung dari loop rAF
  // (dan timeupdate saat scrub manual) tanpa state React, agar 60 fps murah.
  const srcTimeRef = useRef<HTMLSpanElement | null>(null);
  const resTimeRef = useRef<HTMLSpanElement | null>(null);
  // Loop sinkronisasi rAF pemutaran banding (null = tidak berjalan).
  const syncLoopRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  // Audio sumber: AudioContext + buffer PCM hasil decode (sekali per video).
  // Diputar ulang via BufferSource → MediaStreamDestination saat rekam —
  // elemen video TIDAK pernah diputar (hanya di-seek/di-draw), karena
  // memutar elemen video yang sudah pernah lewat WebAudio bisa membuat
  // drawImage berikutnya men-taint canvas (perilaku Chromium).
  const audioCtxRef = useRef<AudioContext | null>(null);
  // State bersama AudioBuffer sumber (buffer + promise): dibagi indikator
  // waveform DAN perekaman via `resolveSharedAudioBuffer` — keduanya menerima
  // instance yang sama, decode hanya sekali (lihat videoEnhance.ts).
  const audioSharedRef = useRef<SharedAudioState>(createSharedAudioState());
  // Web Worker pipeline per-frame (deteksi wajah + enhancePixels +
  // temporalBlend) — UI tetap responsif untuk video panjang; fallback thread
  // utama bila browser tanpa Worker.
  const useWorker = typeof Worker !== "undefined";
  const faceWorkerClient = useMemo(
    () =>
      createWorkerClient<FaceWorkerRequestNoId, FaceWorkerResponse>({
        createWorker: () =>
          new Worker(new URL("./faceWorker.ts", import.meta.url), {
            type: "module",
          }),
        errorMessage: "Worker gagal memproses frame.",
      }),
    []
  );
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
      stopWaveAudio();
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
        // Objek state DIGANTI (bukan dimutasi): decode yang masih berjalan
        // menulis ke objek lama → tidak bocor ke video berikutnya.
        audioSharedRef.current = createSharedAudioState();
      }
      stopSyncLoop();
      // Hentikan worker per-frame: tolak permintaan yang masih menunggu agar
      // tidak menggantung, lalu terminate.
      faceWorkerClient.terminate();
      const { videoUrl: vUrl, resultUrl: rUrl } = urlsRef.current;
      if (vUrl) URL.revokeObjectURL(vUrl);
      if (rUrl) URL.revokeObjectURL(rUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);



  /**
   * Pastikan AudioBuffer sumber ter-decode (sekali per video; hasil di-cache
   * di `audioSharedRef`). Dipakai indikator waveform (segera setelah upload)
   * dan `run()` (saat rekaman) — keduanya berbagi promise yang sama, jadi
   * tidak ada decode ganda atau race, dan menerima instance yang sama persis.
   * `null` bila tanpa audio / decode gagal / terlalu besar.
   */
  const ensureAudioBuffer = (): Promise<AudioBuffer | null> =>
    resolveSharedAudioBuffer(audioSharedRef.current, async () => {
      if (!videoUrl) return null;
      try {
        const raw = await (await fetch(videoUrl)).arrayBuffer();
        const decoded = await decodeAudioBuffer(raw);
        const bytes =
          decoded !== null
            ? decoded.length *
              decoded.numberOfChannels *
              Float32Array.BYTES_PER_ELEMENT
            : Infinity;
        return bytes <= MAX_AUDIO_BYTES ? decoded : null;
      } catch {
        return null;
      }
    });

  /** Hentikan pemutaran cek cepat audio sumber (klik waveform) bila sedang
   *  berjalan — dipakai toggle, ganti video, dan cleanup unmount. */
  const stopWaveAudio = () => {
    if (waveSourceRef.current) {
      try {
        waveSourceRef.current.stop();
      } catch {
        // sudah berhenti — abaikan
      }
      waveSourceRef.current = null;
    }
    setWavePlaying(false);
  };

  /**
   * Putar/jeda audio sumber untuk cek cepat tanpa membuka pemutar penuh:
   * klik waveform memutar AudioBuffer ter-decode (BufferSource → destination)
   * dari awal; klik lagi menghentikannya. Elemen video tidak pernah diputar.
   */
  const toggleWaveAudio = () => {
    const buf = audioSharedRef.current.buffer;
    if (!buf) return;
    if (waveSourceRef.current) {
      stopWaveAudio();
      return;
    }
    // Context dibuat/resume dalam gestur klik (autoplay dengan suara diizinkan).
    const ctx =
      audioCtxRef.current ?? (audioCtxRef.current = makeAudioContext());
    if (!ctx) return;
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      waveSourceRef.current = null;
      setWavePlaying(false);
    };
    waveSourceRef.current = src;
    try {
      src.start();
    } catch {
      waveSourceRef.current = null;
      setWavePlaying(false);
      return;
    }
    setWavePlaying(true);
  };

  // Decode audio segera setelah video dipilih → indikator waveform meyakinkan
  // pengguna bahwa track audio benar-benar terbaca (bukan hanya ada track).
  useEffect(() => {
    if (!videoUrl || hasAudio !== true) {
      setAudioStatus("idle");
      setWaveform(null);
      setWaveStats(null);
      return;
    }
    let cancelled = false;
    setAudioStatus("decoding");
    void ensureAudioBuffer().then((buf) => {
      if (cancelled) return;
      if (buf) {
        const peaks = computePeaks(buf);
        setWaveform(peaks);
        setWaveStats(
          computeWaveStats(peaks, buf.duration, buf.numberOfChannels)
        );
        setAudioStatus("ready");
      } else {
        setWaveform(null);
        setWaveStats(null);
        setAudioStatus("failed");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, hasAudio]);

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
      // Video baru → audio buffer/promise lama TIDAK berlaku (jangan diputar
      // ulang untuk video lain) — indikator waveform ikut di-reset dan akan
      // di-decode ulang oleh efek [videoUrl, hasAudio].
      stopWaveAudio();
      audioSharedRef.current = createSharedAudioState();
      setWaveform(null);
      setWaveStats(null);
      setAudioStatus("idle");
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
    // Sampling frame: proses sebagian frame (semua/setengah/sepertiga) untuk
    // video panjang — tiap frame hasil ditahan beberapa slot output, jadi
    // durasi & fps hasil tetap sama, hanya kehalusan gerak berkurang.
    const sampling = params.frameSampling;
    const sf = samplingFactor(sampling);
    const processTotal = sampledFrames(total, sampling);
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
    // Audio sumber (di-cache): biasanya sudah ter-decode oleh indikator
    // waveform segera setelah upload; di sini hanya menunggu promise yang sama.
    let audioBuffer: AudioBuffer | null = audioSharedRef.current.buffer;
    if (hasAudio && !audioBuffer) {
      audioBuffer = await ensureAudioBuffer();
    }
    /** Buat perekam canvas + audio (helper bersama recordWithAudio). */
    const startRecorder = (): AudioRecorder => {
      const rec = recordWithAudio({
        canvas,
        fps: params.fps,
        mimeType: mime,
        audio:
          audioCtxRef.current && audioBuffer
            ? { context: audioCtxRef.current, buffer: audioBuffer }
            : null,
      });
      recorderRef.current = rec.recorder;
      return rec;
    };

    const frameBytes = w * h * 4;
    const canPrerender = processTotal * frameBytes <= 180 * 1024 * 1024;
    cancelledRef.current = false;
    setProcessing(true);
    setProgress({ done: 0, total: processTotal });
    // Frame hasil sebelumnya — hanya dipakai fallback thread utama (di worker,
    // prev dipegang worker dan di-reset via pesan "reset").
    let prev: Uint8ClampedArray | null = null;
    let faceCount = 0;

    // Awali tiap run dengan prev kosong agar koherensi temporal tidak bocor
    // dari run/video sebelumnya (worker menyimpan prev secara internal).
    if (useWorker) {
      try {
        await faceWorkerClient.post({ type: "reset" });
      } catch {
        // worker gagal — proses di thread utama sebagai fallback
      }
    }

    /** Proses satu frame: seek → draw → pipeline (worker atau thread utama).
     *  Pipeline berat (deteksi wajah + enhancePixels + temporalBlend) berjalan
     *  di Web Worker; thread utama hanya seek/draw/getImageData yang ringan. */
    const processOne = async (i: number): Promise<Uint8ClampedArray | null> => {
      if (cancelledRef.current) return null;
      const t = Math.min(meta.duration, i / params.fps);
      await seekTo(video, t);
      if (cancelledRef.current) return null;
      ctx.drawImage(video, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, w, h);
      if (useWorker) {
        // Piksel dikirim via transfer (tanpa salin); hasil di-transfer balik.
        const res = await faceWorkerClient.post(
          {
            type: "processFrame",
            pixels: img.data.buffer,
            w,
            h,
            params,
            temporal: params.temporal,
          },
          [img.data.buffer]
        );
        if (res.type !== "processFrame" || !res.ok) {
          throw new Error(
            res.type === "processFrame"
              ? res.error
              : "Worker tidak merespons permintaan frame."
          );
        }
        const out = new Uint8ClampedArray(res.pixels);
        if (res.faceDetected) faceCount++;
        return out;
      }
      // Fallback thread utama (browser tanpa Worker) — sumber tunggal yang
      // sama dengan worker, jadi hasil identik.
      const { out, faceDetected } = processFramePixels(
        img.data,
        w,
        h,
        params,
        params.temporal,
        prev
      );
      prev = out;
      if (faceDetected) faceCount++;
      return out;
    };

    let recorder: AudioRecorder | null = null;
    try {
      if (canPrerender) {
        // Fase 1: proses frame terpilih (setiap `sf`-slot) ke buffer (recorder
        // BELUM mulai — tidak ada kanvas kosong yang ikut terekam).
        const buffers: Uint8ClampedArray[] = [];
        for (let j = 0; j < processTotal; j++) {
          if (cancelledRef.current) break;
          const out = await processOne(j * sf);
          if (out) buffers.push(out);
          setProgress({ done: j + 1, total: processTotal });
          if (j % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
        // Fase 2: mulai rekam, lalu putImageData buffer pada jadwal fps yang
        // tepat — tiap frame hasil ditahan `sf` slot berturut-turut (durasi
        // output ≈ sumber; kehalusan gerak berkurang sesuai sampling).
        // putImageData jauh lebih cepat daripada drawImage+enhance, jadi fase
        // ini selalu mengikuti waktu nyata. Audio diputar ulang dari buffer via
        // BufferSource → destination agar track audio asli mengalir (video
        // sumber tetap pause).
        if (!cancelledRef.current && buffers.length === processTotal) {
          recorder = startRecorder();
          const t0 = performance.now();
          const interval = 1000 / params.fps;
          for (let i = 0; i < total; i++) {
            if (cancelledRef.current) break;
            const wait = t0 + i * interval - performance.now();
            if (wait > 1) await sleep(wait);
            const idx = Math.min(processTotal - 1, sampledBufferIndex(i, sampling));
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(buffers[idx]), w, h),
              0,
              0
            );
            if (i % 5 === 4 || i === total - 1) {
              setProgress({ done: idx + 1, total: processTotal });
            }
          }
        }
      } else {
        // Video panjang: rekam live sambil proses (bila pemrosesan lebih
        // lambat dari fps, durasi output bisa lebih panjang — dijelaskan di UI).
        recorder = startRecorder();
        const t0 = performance.now();
        const interval = 1000 / params.fps;
        for (let j = 0; j < processTotal; j++) {
          if (cancelledRef.current) break;
          const out = await processOne(j * sf);
          if (!out) break;
          // Tahan frame hasil selama `sf` slot output (durasi tetap ≈ sumber).
          for (let k = 0; k < sf; k++) {
            const i = j * sf + k;
            if (i >= total) break;
            const wait = t0 + i * interval - performance.now();
            if (wait > 1) await sleep(wait);
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(out), w, h),
              0,
              0
            );
          }
          setProgress({ done: j + 1, total: processTotal });
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
          // Hentikan audio + perekaman, kumpulkan chunk, hentikan track.
          await recorder.stop();
        } catch {
          // recorder sudah berhenti / gagal — buang hasil parsial
        }
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

  /** Hentikan loop sinkronisasi pemutaran banding (rAF). */
  function stopSyncLoop() {
    if (syncLoopRef.current !== null) {
      cancelAnimationFrame(syncLoopRef.current);
      syncLoopRef.current = null;
    }
  }

  /** Jeda kedua pemutar banding dan hentikan loop sinkronisasi. */
  function stopBoth() {
    stopSyncLoop();
    try {
      srcVideoRef.current?.pause();
      resultVideoRef.current?.pause();
    } catch {
      // abaikan
    }
  }

  /**
   * Putar video sumber & hasil BERSAMAAN dari 0 (perbandingan audio/video A/B
   * yang sinkron). Dipicu gestur klik → autoplay dengan suara diizinkan
   * browser. Selama berjalan, loop rAF menjaga kedua pemutar sejajar (drift
   * > 0,12 dtk di-seek ulang, master = sumber); bila salah satu jeda/berakhir,
   * keduanya berhenti.
   */
  function playBothSync() {
    const src = srcVideoRef.current;
    const res = resultVideoRef.current;
    if (!src || !res) return;
    stopSyncLoop();
    try {
      src.currentTime = 0;
      res.currentTime = 0;
    } catch {
      // abaikan
    }
    if (srcTimeRef.current) srcTimeRef.current.textContent = "0:00:00.0";
    if (resTimeRef.current) resTimeRef.current.textContent = "0:00:00.0";
    void Promise.allSettled([src.play(), res.play()]);
    const tick = () => {
      if (!src || !res) return;
      // Keduanya berhenti (pengguna menguasai pemutaran) → lepas sinkronisasi.
      if (src.paused && res.paused) {
        stopSyncLoop();
        return;
      }
      // Salah satu dijeda → jeda pasangannya agar tetap sinkron.
      if (src.paused !== res.paused) {
        if (src.paused) res.pause();
        else src.pause();
      }
      if (!src.paused && !res.paused) {
        const drift = src.currentTime - res.currentTime;
        if (Math.abs(drift) > 0.12) {
          res.currentTime = src.currentTime; // master = sumber
        }
      }
      // Timecode sinkron di atas kedua video — diperbarui tiap frame agar
      // terlihat sejajar (nilai sama) atau melenceng (nilai beda).
      if (srcTimeRef.current) {
        srcTimeRef.current.textContent = formatTimecode(src.currentTime);
      }
      if (resTimeRef.current) {
        resTimeRef.current.textContent = formatTimecode(res.currentTime);
      }
      if (src.ended || res.ended) {
        stopBoth();
        return;
      }
      syncLoopRef.current = requestAnimationFrame(tick);
    };
    syncLoopRef.current = requestAnimationFrame(tick);
  }

  /** Tombol mute eksplisit: bisukan/suarakan kedua pemutar banding sekaligus. */
  function toggleMute() {
    const next = !compareMuted;
    setCompareMuted(next);
    if (srcVideoRef.current) srcVideoRef.current.muted = next;
    if (resultVideoRef.current) resultVideoRef.current.muted = next;
  }

  // Timecode banding di-reset ke 0:00:00.0 saat hasil baru dibuat.
  useEffect(() => {
    if (srcTimeRef.current) srcTimeRef.current.textContent = "0:00:00.0";
    if (resTimeRef.current) resTimeRef.current.textContent = "0:00:00.0";
  }, [resultUrl]);

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
                    {audioStatus === "decoding" ? (
                      <span className="wave-note">⏳ membaca audio…</span>
                    ) : audioStatus === "failed" ? (
                      <span
                        className="wave-note wave-fail"
                        title="Track audio ada, tapi gagal di-decode (format tak didukung atau terlalu besar) — hasil akan direkam tanpa suara."
                      >
                        ⚠️ audio tak terbaca
                      </span>
                    ) : waveform ? (
                      <span
                        className="wave-wrap"
                        data-tip={formatWaveTip(waveStats)}
                      >
                      <svg
                        className={wavePlaying ? "waveform playing" : "waveform"}
                        width={160}
                        height={24}
                        viewBox="0 0 160 24"
                        role="button"
                        tabIndex={0}
                        aria-label={
                          wavePlaying
                            ? "Jeda audio sumber (klik untuk menghentikan)"
                            : "Putar audio sumber (klik untuk memutar, cek cepat)"
                        }
                        aria-pressed={wavePlaying}
                        onClick={toggleWaveAudio}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleWaveAudio();
                          }
                        }}
                      >
                        <title>
                          {wavePlaying
                            ? "Memutar audio sumber — klik untuk menghentikan"
                            : "Klik untuk memutar audio sumber (cek cepat)"}
                          {waveStats ? ` — ${formatWaveTip(waveStats)}` : ""}
                        </title>
                        {Array.from(waveform, (p, i) => {
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
                  setResultUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setMeta(null);
                  setProgress(null);
                  setError("");
                  setHasAudio(null);
                  stopWaveAudio();
                  audioSharedRef.current = createSharedAudioState();
                  setWaveform(null);
                  setWaveStats(null);
                  setAudioStatus("idle");
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

          {resultUrl && (
            <section className="panel">
              <div className="bg-compare">
                <figure>
                  <figcaption>
                    Sebelum (video asli)
                    <span className="compare-time" ref={srcTimeRef}>
                      0:00:00.0
                    </span>
                  </figcaption>
                  <video
                    ref={srcVideoRef}
                    src={videoUrl}
                    controls
                    muted={compareMuted}
                    className="bg-preview-img"
                    onTimeUpdate={() => {
                      if (srcTimeRef.current) {
                        srcTimeRef.current.textContent = formatTimecode(
                          srcVideoRef.current?.currentTime ?? 0
                        );
                      }
                    }}
                  />
                </figure>
                <figure>
                  <figcaption>
                    Sesudah (face restored)
                    <span className="compare-time" ref={resTimeRef}>
                      0:00:00.0
                    </span>
                  </figcaption>
                  <video
                    ref={resultVideoRef}
                    src={resultUrl}
                    controls
                    muted={compareMuted}
                    className="bg-preview-img"
                    onTimeUpdate={() => {
                      if (resTimeRef.current) {
                        resTimeRef.current.textContent = formatTimecode(
                          resultVideoRef.current?.currentTime ?? 0
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
                  onClick={playBothSync}
                  title="Putar video asli & hasil bersamaan dari awal, disinkronkan (perbandingan audio/video A/B)"
                >
                  ▶️ Putar Keduanya (Sinkron)
                </button>
                <button type="button" className="btn" onClick={toggleMute}>
                  {compareMuted ? "🔇 Suarakan" : "🔊 Bisukan"}
                </button>
                <button type="button" className="btn" onClick={stopBoth}>
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
                  faceFrames > 0 ? "face-note face-found" : "face-note face-miss"
                }
              >
                {faceFrames > 0
                  ? `😀 Wajah terdeteksi di ${faceFrames} dari ${sampledFrames(
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
