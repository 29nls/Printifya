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
}

export const DEFAULT_VIDEO_PARAMS: VideoEnhanceParams = {
  ...NEUTRAL_PARAMS,
  temporal: 45,
  fps: 15,
  resMode: "720",
  format: "webm",
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
