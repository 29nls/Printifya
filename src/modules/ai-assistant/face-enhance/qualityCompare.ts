/**
 * Perbandingan kualitas antara pipeline Face Enhance (CodeFormer-style) dan
 * Video Face Enhance (PGTFormer-style) pada frame foto yang sama.
 *
 * Sisi video didelegasikan penuh ke `processFramePixels` (videoEnhance.ts) —
 * SUMBER TUNGGAL logika per-frame modul video, dipakai worker video DAN
 * fallback thread utama — dengan `temporal = 0` dan `prev = null`
 * (temporalBlend bersifat identitas pada satu frame diam). Dengan begitu
 * perbandingan dijamin mencerminkan persis apa yang dihasilkan jalur video
 * dan tidak melenceng diam-diam bila pipeline diubah: perbedaan hasil hanya
 * berasal dari parameter tersimpan tiap modul dan resolusi kerja (video
 * beroperasi di `resMode` 512/720/asli). Metrik `comparePixels` (PSNR +
 * diff) mengukur seberapa jauh kedua hasil menyimpang.
 *
 * Bagian murni `comparePixels` terpisah agar bisa diuji tanpa canvas;
 * `runFramePipeline`/`comparePipelines` adalah pembungkus canvas (pola yang
 * sama dengan `enhanceFace`).
 */

import { processFramePixels } from "../../shared/facePipeline";
import type { FaceEnhanceParams } from "./faceEnhance";

export interface CompareMetrics {
  /** PSNR dalam dB; `Infinity` bila kedua hasil identik; `null` bila dimensi
   *  buffer berbeda (PSNR tidak terdefinisi). */
  psnr: number | null;
  /** Rata-rata selisih absolut per kanal RGB (0..255). */
  meanAbsDiff: number;
  /** Selisih absolut maksimum per kanal RGB (0..255). */
  maxDiff: number;
  /** Persentase piksel (0..100) yang berubah lebih dari 8 level di salah satu
   *  kanal RGB — piksel yang "terlihat berbeda". */
  pctChanged: number;
  w: number;
  h: number;
}

/**
 * Metrik perbedaan dua buffer RGBA berukuran w×h (kanal RGB saja; alpha
 * diabaikan — sama dengan perbandingan visual). Mengembalikan null bila
 * panjang buffer tidak cocok (dimensi berbeda → PSNR tak terdefinisi).
 */
export function comparePixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  w: number,
  h: number
): CompareMetrics | null {
  if (a.length !== b.length || a.length !== w * h * 4) return null;
  let mse = 0;
  let sumAbs = 0;
  let maxDiff = 0;
  let changed = 0;
  const n = w * h;
  for (let i = 0; i < a.length; i += 4) {
    const dR = a[i] - b[i];
    const dG = a[i + 1] - b[i + 1];
    const dB = a[i + 2] - b[i + 2];
    mse += dR * dR + dG * dG + dB * dB;
    sumAbs += Math.abs(dR) + Math.abs(dG) + Math.abs(dB);
    const max = Math.max(Math.abs(dR), Math.abs(dG), Math.abs(dB));
    if (max > maxDiff) maxDiff = max;
    if (max > 8) changed++;
  }
  const mseAvg = mse / (3 * n);
  return {
    psnr: mseAvg === 0 ? Infinity : 10 * Math.log10((255 * 255) / mseAvg),
    meanAbsDiff: sumAbs / (3 * n),
    maxDiff,
    pctChanged: (changed / n) * 100,
    w,
    h,
  };
}

type ImageSource = HTMLImageElement | HTMLCanvasElement;

export interface PipelineOutput {
  canvas: HTMLCanvasElement;
  /** Buffer hasil `enhancePixels` — sumber metrik (tanpa baca ulang canvas). */
  data: Uint8ClampedArray;
  faceDetected: boolean;
}

/**
 * Jalankan pipeline per-frame PERSIS seperti jalur video pada satu frame
 * gambar berukuran w×h: delegasi penuh ke `processFramePixels` (sumber
 * tunggal logika per-frame modul video — dipakai Web Worker video DAN
 * fallback thread utama) dengan `temporal = 0` dan `prev = null`
 * (temporalBlend identitas pada satu frame diam). Deteksi wajah berjalan
 * murni di dalam pipeline (detectFaceFromPixels), tanpa kanvas deteksi
 * tambahan. Perbandingan kualitas dengan demikian dijamin mencerminkan apa
 * yang benar-benar dihasilkan jalur video dan tidak melenceng diam-diam bila
 * pipeline diubah — PSNR hanya mencerminkan perbedaan parameter.
 */
export function runFramePipeline(
  source: ImageSource,
  params: FaceEnhanceParams,
  w: number,
  h: number
): PipelineOutput {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D tidak tersedia.");
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const { out, faceDetected } = processFramePixels(
    img.data,
    w,
    h,
    params,
    0,
    null
  );
  // Salinan eksplisit agar buffer ber-backing ArrayBuffer (kontrak ImageData).
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);
  return { canvas, data: out, faceDetected };
}

export interface CompareResult {
  /** Hasil pipeline Face Enhance (parameter modul Face Enhance saat ini). */
  face: PipelineOutput;
  /** Hasil pipeline Video Face Enhance (parameter tersimpan modul video). */
  video: PipelineOutput;
  /** Metrik perbedaan; null bila dimensi tidak cocok (seharusnya tidak
   *  terjadi karena kedua pipeline memakai w×h yang sama). */
  metrics: CompareMetrics | null;
}

/**
 * Bandingkan kedua pipeline pada frame yang sama (resolusi kerja sama, w×h):
 * masing-masing mendeteksi wajah pada kanvas kerjanya sendiri (pola modul
 * video), sehingga PSNR mencerminkan perbedaan parameter murni.
 */
export function comparePipelines(
  source: ImageSource,
  faceParams: FaceEnhanceParams,
  videoParams: FaceEnhanceParams,
  w: number,
  h: number
): CompareResult {
  const face = runFramePipeline(source, faceParams, w, h);
  const video = runFramePipeline(source, videoParams, w, h);
  return { face, video, metrics: comparePixels(face.data, video.data, w, h) };
}
