/**
 * Video Face Enhance — restorasi wajah pada video heuristik, terinspirasi
 * PGTFormer (kepengxu/PGTFormer, IJCAI'24: "Beyond Alignment: Blind Video Face
 * Restoration via Parsing-Guided Temporal-Coherent Transformer"), tanpa model
 * ML / jaringan saraf.
 *
 * Fitur PGTFormer yang ditiru secara heuristik:
 * - Restorasi wajah buta per frame: tiap frame memakai pipeline `faceEnhance`
 *   (pemulusan kulit + koreksi warna + ketajaman di dalam kotak wajah hasil
 *   `detectFace` per frame — padanan "parsing-guided": area wajah dipulihkan
 *   lebih kuat daripada latar).
 * - Koherensi temporal tanpa pre-alignment: hasil frame di-blend dengan frame
 *   yang sudah diproses sebelumnya (kuat di kotak wajah, lemah di latar) untuk
 *   mengurangi kedipan (flicker) antar frame — padanan transformer
 *   temporal-coherent, tanpa perlu menyelaraskan pose wajah.
 * - Resolusi kerja 512 px disediakan (repo asli beroperasi di 512×512).
 *
 * Bagian murni (tanpa DOM) dipisah agar bisa diuji tanpa canvas/video:
 * `pickWorkingSize`, `countFrames`, `temporalBlend`. Orkestrasi
 * video/canvas/MediaRecorder ada di index.tsx.
 */

import { detectFaceFromPixels } from "../../photo-studio/shared/faceDetect";
import {
  computeFaceBox,
  computeStretch,
  enhancePixels,
  NEUTRAL_PARAMS,
  type FaceBoxPx,
  type FaceEnhanceParams,
} from "../face-enhance/faceEnhance";

/** Parameter video — per-frame memakai `FaceEnhanceParams` (fidelitas w, dll.). */
export interface VideoEnhanceParams extends FaceEnhanceParams {
  /** 0..100 — koherensi temporal (PGTFormer): seberapa kuat hasil frame
   *  di-blend dengan frame sebelumnya untuk mengurangi kedipan. */
  temporal: number;
  /** Frame per detik output (sampling video & kecepatan MediaRecorder). */
  fps: number;
  /** Resolusi kerja: "512" (sesuai PGTFormer) | "720" | "orig" (asli). */
  resMode: "512" | "720" | "orig";
  /** Wadah output video: "webm" | "mp4" (bila didukung browser). */
  format: "webm" | "mp4";
  /** Sampling frame: proses semua / setengah / sepertiga frame sumber —
   *  mempercepat video panjang dengan trade-off kehalusan gerak (tiap frame
   *  hasil ditahan beberapa slot output, durasi & fps tetap sama). */
  frameSampling: FrameSampling;
}

/** Opsi sampling frame: "all" (semua) | "half" (setengah) | "third" (sepertiga). */
export type FrameSampling = "all" | "half" | "third";
export const FRAME_SAMPLING: readonly FrameSampling[] = [
  "all",
  "half",
  "third",
];

/** Faktor sampling: 1 = semua, 2 = setengah, 3 = sepertiga. */
export function samplingFactor(sampling: FrameSampling): number {
  return sampling === "half" ? 2 : sampling === "third" ? 3 : 1;
}

/** Jumlah frame yang benar-benar diproses untuk `total` slot output (fps
 *  penuh); minimal 1 (video sangat pendek tetap diproses). */
export function sampledFrames(total: number, sampling: FrameSampling): number {
  return Math.max(1, Math.ceil(total / samplingFactor(sampling)));
}

/** Indeks buffer frame terproses untuk slot output ke-`i` (tiap frame hasil
 *  ditahan `samplingFactor` slot — durasi output ≈ sumber). */
export function sampledBufferIndex(i: number, sampling: FrameSampling): number {
  return Math.floor(i / samplingFactor(sampling));
}

export const DEFAULT_VIDEO_PARAMS: VideoEnhanceParams = {
  ...NEUTRAL_PARAMS,
  temporal: 45,
  fps: 15,
  resMode: "720",
  format: "webm",
  frameSampling: "all",
};

export const FPS_OPTIONS = [10, 15, 24, 30] as const;
export const RES_MODES = ["512", "720", "orig"] as const;
export const FORMATS = ["webm", "mp4"] as const;

/**
 * Pipeline per-frame lengkap pada piksel mentah (murni, tanpa DOM): deteksi
 * wajah (`detectFaceFromPixels`) → kotak wajah → bentangan histogram →
 * `enhancePixels` → `temporalBlend` terhadap `prev`. SUMBER TUNGGAL logika
 * per-frame — dipakai Web Worker (`faceWorker.ts`) DAN fallback thread utama
 * di `index.tsx`, jadi hasil kedua jalur identik. `prev` = frame hasil
 * sebelumnya (null untuk frame pertama → temporalBlend identitas).
 */
export function processFramePixels(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  params: FaceEnhanceParams,
  temporal: number,
  prev: Uint8ClampedArray | null
): { out: Uint8ClampedArray; faceDetected: boolean } {
  const face = detectFaceFromPixels(data, w, h);
  const box = computeFaceBox(face, w, h);
  const stretch = computeStretch(
    data,
    w,
    box ?? { x0: 0, y0: 0, x1: w, y1: h }
  );
  const out = enhancePixels(data, w, h, box, params, stretch);
  temporalBlend(out, prev, w, h, box, temporal);
  return { out, faceDetected: box !== null };
}

/**
 * Pengukur kecepatan pemrosesan nyata (frame/detik) dengan jendela geser:
 * `mark()` dipanggil tiap kali SATU frame selesai diproses; fps dihitung dari
 * jumlah frame dalam `windowMs` terakhir (default 2 dtk) — tahan terhadap
 * lonjakan sesaat dan tidak sensitif terhadap jeda antar proses.
 */
export interface FpsMeter {
  /** Catat satu frame selesai (waktu default `performance.now()`);
   *  kembalikan fps jendela geser (0 bila data belum cukup). */
  mark(now?: number): number;
  reset(): void;
}

export function createFpsMeter(windowMs = 2000): FpsMeter {
  let times: number[] = [];
  return {
    mark(now = performance.now()) {
      times.push(now);
      const cutoff = now - windowMs;
      while (times.length > 0 && times[0] < cutoff) times.shift();
      const span = times.length > 1 ? now - times[0] : 0;
      return span > 0 ? (times.length - 1) / (span / 1000) : 0;
    },
    reset() {
      times = [];
    },
  };
}

/** Format perkiraan sisa waktu untuk bilah progres — "5.4 dtk" / "2 m 05 dtk";
 *  string kosong untuk nilai invalid/negatif. Murni, bisa diuji. */
export function formatEta(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "";
  if (sec < 10) return `${sec.toFixed(1)} dtk`;
  if (sec < 60) return `${Math.round(sec)} dtk`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m} m ${String(s).padStart(2, "0")} dtk` : `${m} m`;
}

// Helper audio bersama (state AudioBuffer + decode OfflineAudioContext) —
// dipakai Video Face Enhance (waveform & rekaman) DAN Slideshow to Video
// (musik latar pratinjau & rekaman): decode sekali, instance sama.
export {
  createSharedAudioState,
  resolveSharedAudioBuffer,
  type SharedAudioState,
} from "../../shared/audioShared";

/** Ukuran kerja (lebar × tinggi, dimensi genap agar aman untuk codec video).
 *  "orig" mempertahankan ukuran asli; "512"/"720" membatasi sisi terpanjang
 *  dengan mempertahankan rasio aspek (PGTFormer beroperasi di 512×512). */
export function pickWorkingSize(
  srcW: number,
  srcH: number,
  mode: VideoEnhanceParams["resMode"]
): { w: number; h: number } {
  if (mode === "orig") {
    return { w: Math.max(2, srcW), h: Math.max(2, srcH) };
  }
  const cap = mode === "512" ? 512 : 720;
  const s = Math.min(1, cap / Math.max(1, Math.max(srcW, srcH)));
  const even = (v: number) => Math.max(2, Math.round((v * s) / 2) * 2);
  return { w: even(srcW), h: even(srcH) };
}

/** Jumlah frame yang diproses untuk video berdurasi `durationSec` detik pada
 *  `fps` frame per detik; minimal 1 (video sangat pendek tetap diproses). */
export function countFrames(durationSec: number, fps: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0 || fps <= 0) return 0;
  return Math.max(1, Math.round(durationSec * fps));
}

/**
 * Hitung puncak absolut gabungan kanal per bucket (0..1) dari AudioBuffer —
 * data untuk mini waveform indikator audio sumber. `buckets` = jumlah batang
 * waveform (default 160). Buffer kosong → semua nol; buffer yang lebih pendek
 * dari buckets tetap aman (tiap bucket minimal 1 sampel).
 */
export function computePeaks(buffer: AudioBuffer, buckets = 160): Float32Array {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const n = ch0.length;
  const peaks = new Float32Array(buckets);
  if (n === 0 || buckets <= 0) return peaks;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * n) / buckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / buckets));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(ch0[i]);
      if (v > peak) peak = v;
      if (ch1) {
        const v2 = Math.abs(ch1[i]);
        if (v2 > peak) peak = v2;
      }
    }
    peaks[b] = peak;
  }
  return peaks;
}

/** Timecode HH:MM:SS.d — tampilan sinkron di atas video banding A/B
 *  (nilai yang sama di kedua pemutar saat sejajar). Murni, bisa diuji. */
export function formatTimecode(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00:00.0";
  const totalTenths = Math.floor(t * 10);
  const h = Math.floor(totalTenths / 36000);
  const m = Math.floor((totalTenths % 36000) / 600);
  const s = Math.floor((totalTenths % 600) / 10);
  const d = totalTenths % 10;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

/** Statistik ringkas audio sumber untuk tooltip waveform: puncak (dB) dari
 *  bucket peak (0..1) + durasi + jumlah kanal. Murni — bisa diuji tanpa DOM.
 *  `peakDb` ≤ 0 dB (full-scale = 0), `-Infinity` untuk senyap penuh. */
export function computeWaveStats(
  peaks: Float32Array,
  duration: number,
  channels: number
): { duration: number; peakDb: number; channels: number } {
  let peak = 0;
  for (let i = 0; i < peaks.length; i++) {
    if (peaks[i] > peak) peak = peaks[i];
  }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  return { duration, peakDb, channels };
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, v));

/**
 * Koherensi temporal (PGTFormer): blend buffer hasil `out` dengan frame
 * sebelumnya `prev` (in-place). Kuat di dalam kotak wajah (tc × 0,55), lemah di
 * luar (tc × 0,12) — wajah distabilkan lintas frame tanpa pre-alignment,
 * latar ikut sedikit distabilkan agar kedipan berkurang. `tc` = 0 → identitas.
 */
export function temporalBlend(
  out: Uint8ClampedArray,
  prev: Uint8ClampedArray | null,
  w: number,
  h: number,
  box: FaceBoxPx | null,
  tc: number
): void {
  if (!prev || prev.length !== out.length || tc <= 0) return;
  const faceK = Math.min(1, (tc / 100) * 0.55);
  const bgK = Math.min(1, (tc / 100) * 0.12);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k =
        box && x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1
          ? faceK
          : bgK;
      if (k <= 0) continue;
      const i = (y * w + x) * 4;
      out[i] = clamp255(out[i] * (1 - k) + prev[i] * k);
      out[i + 1] = clamp255(out[i + 1] * (1 - k) + prev[i + 1] * k);
      out[i + 2] = clamp255(out[i + 2] * (1 - k) + prev[i + 2] * k);
    }
  }
}
