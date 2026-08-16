/**
 * Hook alur run/rekaman/progress Video Face Enhance — diekstrak dari monolit
 * video-face-enhance/index.tsx (refactor murni, tanpa perubahan perilaku).
 *
 * Memiliki state hasil (resultUrl/resultExt/faceFrames), busy + progress,
 * ref pembatalan (cancelledRef), recorder, token file (fileTokenRef — dipakai
 * handleFile di index untuk membatalkan run saat video diganti), dan klien
 * worker per-frame (faceWorkerClient, di-terminate saat unmount). Audio sumber
 * tetap SATU sumber bersama: `audioCtxRef`/`audioSharedRef`/`ensureAudioBuffer`
 * dari useWaveformAudio diteruskan ke sini — waveform dan rekaman memakai
 * instance/promise AudioBuffer yang sama, decode hanya sekali per video.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject, RefObject } from "react";
import type { SharedAudioState } from "../../shared/audioShared";
import { createWorkerClient } from "../../shared/createWorkerClient";
import {
  recordWithAudio,
  type AudioRecorder,
} from "../../shared/recordWithAudio";
import {
  countFrames,
  createFpsMeter,
  pickWorkingSize,
  processFramePixels,
  sampledBufferIndex,
  sampledFrames,
  samplingFactor,
  type VideoEnhanceParams,
} from "./videoEnhance";
import type {
  FaceWorkerRequestNoId,
  FaceWorkerResponse,
} from "./faceWorkerApi";
import { makeAudioContext } from "./useWaveformAudio";

export interface VideoMeta {
  w: number;
  h: number;
  duration: number;
}

export interface RunProgress {
  done: number;
  total: number;
  /** Kecepatan pemrosesan nyata (frame/detik, jendela geser ~2 dtk). */
  fps: number;
  /** Perkiraan sisa waktu (dtk) berdasarkan fps saat ini. */
  etaSec: number;
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

export interface VideoEnhanceRunApi {
  processing: boolean;
  progress: RunProgress | null;
  resultUrl: string | null;
  resultExt: "webm" | "mp4";
  faceFrames: number;
  mp4Supported: boolean;
  /** Format efektif: MP4 hanya bila didukung browser. */
  effFormat: "webm" | "mp4";
  /** Token file: handleFile di index menaikkan saat video baru dipilih —
   *  run yang sedang berjalan membandingkan token ini dan dibatalkan. */
  fileTokenRef: MutableRefObject<number>;
  /** Proses seluruh video frame per frame → rekam ke WebM/MP4. */
  run: () => Promise<void>;
  /** Hentikan batch: frame yang sedang berjalan diselesaikan, sisanya berhenti. */
  cancel: () => void;
  /** Buang hasil (revoke blob URL) + reset progress — dipakai ganti video. */
  clearResult: () => void;
}

export interface UseVideoEnhanceRunOptions {
  meta: VideoMeta | null;
  params: VideoEnhanceParams;
  hasAudio: boolean | null;
  videoRef: RefObject<HTMLVideoElement>;
  /** AudioContext — dibuat/resume dalam gestur klik (dari useWaveformAudio). */
  audioCtxRef: MutableRefObject<AudioContext | null>;
  /** AudioBuffer sumber (buffer + promise) — SATU sumber untuk waveform
   *  DAN rekaman (dari useWaveformAudio). */
  audioSharedRef: MutableRefObject<SharedAudioState>;
  ensureAudioBuffer: () => Promise<AudioBuffer | null>;
  setError: (msg: string) => void;
}

export function useVideoEnhanceRun(
  opts: UseVideoEnhanceRunOptions
): VideoEnhanceRunApi {
  const {
    meta,
    params,
    hasAudio,
    videoRef,
    audioCtxRef,
    audioSharedRef,
    ensureAudioBuffer,
    setError,
  } = opts;
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultExt, setResultExt] = useState<"webm" | "mp4">("webm");
  const [faceFrames, setFaceFrames] = useState(0);
  const cancelledRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileTokenRef = useRef(0);
  // URL hasil terbaru — dibaca saat unmount (cleanup di bawah), agar revoke
  // hanya terjadi saat komponen benar-benar dilepas, BUKAN saat resultUrl
  // berubah (cleanup lama ikut me-revoke blob hasil setiap kali run baru
  // selesai — membuat pemutar hasil sebelumnya mati).
  const resultUrlRef = useRef<string | null>(null);
  resultUrlRef.current = resultUrl;

  const mp4Supported =
    typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported("video/mp4");
  // Format efektif: MP4 hanya bila didukung browser.
  const effFormat: "webm" | "mp4" =
    params.format === "mp4" && mp4Supported ? "mp4" : "webm";
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

  // Cleanup unmount: batalkan run, stop perekam, terminate worker, revoke blob
  // hasil terbaru. (Revoke blob video sumber tetap di index.tsx.)
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      try {
        recorderRef.current?.stop();
      } catch {
        // abaikan
      }
      // Hentikan worker per-frame: tolak permintaan yang masih menunggu agar
      // tidak menggantung, lalu terminate.
      faceWorkerClient.terminate();
      const rUrl = resultUrlRef.current;
      if (rUrl) URL.revokeObjectURL(rUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearResult = () => {
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setProgress(null);
  };

  /** Hentikan batch: frame yang sedang berjalan diselesaikan, sisanya berhenti. */
  const cancel = () => {
    cancelledRef.current = true;
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
    // Token file saat run dimulai — bila video diganti di tengah proses
    // (handleFile menaikkan fileTokenRef), run DIBATALKAN: loop berhenti dan
    // hasil parsial dibuang tanpa menyentuh state milik file baru. Tanpa ini,
    // loop tetap menggambar dari elemen video yang sumber datanya sudah ditukar
    // (output korup diam-diam) lalu menimpa hasil file baru dengan blob lama.
    const token = fileTokenRef.current;
    const aborted = () =>
      cancelledRef.current || token !== fileTokenRef.current;
    cancelledRef.current = false;
    setProcessing(true);
    // Kecepatan nyata: meter jendela geser di-feed hanya saat frame BENAR-BENAR
    // diproses (bukan fase tulis putImageData) → fps/ETA tidak menyesatkan.
    const fpsMeter = createFpsMeter();
    let lastFps = 0;
    let lastEta = 0;
    const updateProgress = (done: number, processed: boolean) => {
      if (processed) {
        lastFps = fpsMeter.mark();
        lastEta = lastFps > 0 ? (processTotal - done) / lastFps : 0;
      }
      setProgress({
        done,
        total: processTotal,
        fps: lastFps,
        etaSec: lastEta,
      });
    };
    updateProgress(0, false);
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
      if (aborted()) return null;
      const t = Math.min(meta.duration, i / params.fps);
      await seekTo(video, t);
      if (aborted()) return null;
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
          if (aborted()) break;
          const out = await processOne(j * sf);
          if (out) buffers.push(out);
          updateProgress(j + 1, true);
          if (j % 3 === 2) await new Promise((r) => setTimeout(r, 0));
        }
        // Fase 2: mulai rekam, lalu putImageData buffer pada jadwal fps yang
        // tepat — tiap frame hasil ditahan `sf` slot berturut-turut (durasi
        // output ≈ sumber; kehalusan gerak berkurang sesuai sampling).
        // putImageData jauh lebih cepat daripada drawImage+enhance, jadi fase
        // ini selalu mengikuti waktu nyata. Audio diputar ulang dari buffer via
        // BufferSource → destination agar track audio asli mengalir (video
        // sumber tetap pause).
        if (!aborted() && buffers.length === processTotal) {
          recorder = startRecorder();
          const t0 = performance.now();
          const interval = 1000 / params.fps;
          for (let i = 0; i < total; i++) {
            if (aborted()) break;
            const wait = t0 + i * interval - performance.now();
            if (wait > 1) await sleep(wait);
            const idx = Math.min(processTotal - 1, sampledBufferIndex(i, sampling));
            ctx.putImageData(
              new ImageData(new Uint8ClampedArray(buffers[idx]), w, h),
              0,
              0
            );
            if (i % 5 === 4 || i === total - 1) {
              updateProgress(idx + 1, false);
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
          if (aborted()) break;
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
          updateProgress(j + 1, true);
        }
      }
    } catch (e) {
      // Error tak terduga (mis. canvas tainted oleh data lintas-origin) —
      // jangan biarkan UI macet di "Memproses…"; tampilkan pesan dan
      // kembalikan tombol ke kondisi semula (state di-reset di bawah).
      // Run basi (video sudah diganti) tidak boleh menimpa UI file baru.
      if (!aborted()) {
        setError(
          e instanceof Error
            ? e.message
            : "Gagal memproses video (error tak dikenal)."
        );
      }
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
    if (aborted() || !recorder) {
      // dibatalkan (Batal / video diganti) / recorder tidak pernah mulai —
      // buang hasil parsial, jangan sentuh state milik file baru
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

  return {
    processing,
    progress,
    resultUrl,
    resultExt,
    faceFrames,
    mp4Supported,
    effFormat,
    fileTokenRef,
    run,
    cancel,
    clearResult,
  };
}
