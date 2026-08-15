/**
 * Face Enhance — pemulihan kualitas wajah heuristik terinspirasi CodeFormer
 * (sczhou/CodeFormer), tanpa model ML / jaringan.
 *
 * Fitur CodeFormer yang ditiru secara heuristik:
 * - Fidelitas `w` (0..1): CodeFormer memakai bobot fidelitas untuk menyeimbangkan
 *   identitas vs kekuatan pemulihan. Di sini slider 0..100 memetakan ke
 *   `wF = 1 - fidelity/100` yang mengalikan kekuatan semua efek — 100 = foto
 *   hampir tidak berubah, 0 = pemulihan terkuat.
 * - Pemulihan wajah: pemulusan kulit (blur + blend hanya pada piksel kulit di
 *   dalam kotak wajah) + koreksi warna/kontras berbasis histogram + ketajaman
 *   unsharp yang lebih kuat di non-kulit (mata/alis/rambut).
 * - Background enhancement: koreksi warna halus di luar kotak wajah.
 * - Color recovery: pemulihan warna pudar/hitam-putih (saturasi + hangat).
 *
 * Bagian murni (tanpa DOM) dipisah agar bisa diuji: `computeFaceBox`,
 * `computeStretch`, `enhancePixels`. `enhanceFace` hanyalah pembungkus canvas.
 */

import { detectFace, isSkinLike, type FaceRegion } from "../../photo-studio/shared/faceDetect";
import { upscaleCanvas } from "../upscale-denoise/waifu2x";

export interface FaceEnhanceParams {
  /** 0..100 — fidelitas `w` (100 = dekat input, 0 = pemulihan penuh). */
  fidelity: number;
  /** 0..100 — kekuatan pemulusan kulit di area wajah. */
  smooth: number;
  /** 0..100 — ketajaman detail wajah (unsharp mask). */
  sharpen: number;
  /** 0..100 — koreksi warna/kontras berbasis histogram. */
  color: number;
  /** Perbaiki latar juga (CodeFormer: background enhancement). */
  background: boolean;
  /** Pulihkan warna foto pudar / hitam-putih. */
  restoreColor: boolean;
}

export const NEUTRAL_PARAMS: FaceEnhanceParams = {
  fidelity: 40,
  smooth: 55,
  sharpen: 45,
  color: 55,
  background: true,
  restoreColor: false,
};

export interface FaceBoxPx {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Kotak wajah dalam piksel kerja: kotak deteksi + padding 30% tiap sisi agar
 *  mencakup rambut/tepi wajah, ter-clamp ke kanvas. `null` bila tidak ada. */
export function computeFaceBox(
  face: FaceRegion | null,
  w: number,
  h: number
): FaceBoxPx | null {
  if (!face) return null;
  const padX = face.w * 0.3;
  const padY = face.h * 0.3;
  const x0 = Math.max(0, Math.floor((face.x - padX) * w));
  const y0 = Math.max(0, Math.floor((face.y - padY) * h));
  const x1 = Math.min(w, Math.ceil((face.x + face.w + padX) * w));
  const y1 = Math.min(h, Math.ceil((face.y + face.h + padY) * h));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  return { x0, y0, x1, y1 };
}

export interface StretchParams {
  /** Faktor kontras dari bentangan persentil 5%–95%. */
  cf: number;
  /** Pergeseran kecerahan menuju abu-abu 128. */
  bAdd: number;
}

function percentile(hist: Float64Array, total: number, p: number): number {
  const target = (total * p) / 100;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/** Analisis histogram luminance di dalam kotak (atau seluruh gambar) untuk
 *  menyarankan bentangan kontras & kecerahan — pola computeAutoParams. */
export function computeStretch(
  data: Uint8ClampedArray,
  w: number,
  box: FaceBoxPx
): StretchParams {
  const hist = new Float64Array(256);
  let total = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      const lum = Math.round(
        0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      );
      hist[Math.min(255, Math.max(0, lum))]++;
      total++;
    }
  }
  if (total === 0) return { cf: 1, bAdd: 0 };
  const p05 = percentile(hist, total, 5);
  const p95 = percentile(hist, total, 95);
  const span = Math.max(24, p95 - p05);
  const cf = Math.min(2.6, Math.max(1, 255 / span));
  const mid = (p05 + p95) / 2;
  const bAdd = ((128 - mid) / 128) * 60;
  return { cf, bAdd };
}

/** Box blur separable (RGB; alpha disalin) — pola enhance.ts. */
function boxBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number
): Uint8ClampedArray {
  const win = 2 * radius + 1;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const clampX = (x: number) => Math.min(w - 1, Math.max(0, x));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++) {
        sum += src[(row + clampX(x)) * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        tmp[(row + x) * 4 + c] = sum / win;
        const xOut = clampX(x - radius);
        const xIn = clampX(x + radius + 1);
        sum += src[(row + xIn) * 4 + c] - src[(row + xOut) * 4 + c];
      }
    }
  }
  const clampY = (y: number) => Math.min(h - 1, Math.max(0, y));
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) {
        sum += tmp[(clampY(y) * w + x) * 4 + c];
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / win;
        const yOut = clampY(y - radius);
        const yIn = clampY(y + radius + 1);
        sum += tmp[(yIn * w + x) * 4 + c] - tmp[(yOut * w + x) * 4 + c];
      }
    }
  }
  return out;
}

/** Box blur separable untuk mask 1 kanal (Float32) — dipakai feathering. */
function boxBlurMask(
  src: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const win = 2 * radius + 1;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const clampX = (x: number) => Math.min(w - 1, Math.max(0, x));
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + clampX(x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + clampX(x + radius + 1)] - src[row + clampX(x - radius)];
    }
  }
  const clampY = (y: number) => Math.min(h - 1, Math.max(0, y));
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += tmp[clampY(y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum += tmp[clampY(y + radius + 1) * w + x] - tmp[clampY(y - radius) * w + x];
    }
  }
  return out;
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, v));

/** Pulihkan warna (saturasi + hangat) pada satu piksel (in-place). */
function restoreColorAt(out: Uint8ClampedArray, i: number): void {
  const r = out[i];
  const g = out[i + 1];
  const b = out[i + 2];
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const sat = 1.22;
  out[i] = clamp255(gray + (r - gray) * sat + 7);
  out[i + 1] = clamp255(gray + (g - gray) * sat + 4);
  out[i + 2] = clamp255(gray + (b - gray) * sat - 5);
}

/**
 * Terapkan pipeline pemulihan wajah pada buffer piksel (murni, tanpa DOM).
 * `box` = kotak wajah piksel; `null` = tanpa wajah → koreksi global lembut.
 * Mengembalikan buffer baru; input tidak diubah.
 */
export function enhancePixels(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  box: FaceBoxPx | null,
  params: FaceEnhanceParams,
  stretch: StretchParams
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const wF = 1 - params.fidelity / 100; // 0..1 — kekuatan pemulihan (invers w)
  const smoothAmt = (params.smooth / 100) * (0.15 + 0.85 * wF);
  const colorAmt = (params.color / 100) * (0.2 + 0.8 * wF);
  const sharpenAmt = (params.sharpen / 100) * 1.4 * (0.2 + 0.8 * wF);
  const b = box ?? { x0: 0, y0: 0, x1: w, y1: h };
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  if (bw <= 0 || bh <= 0) return out;

  // Region kotak wajah: ekstrak RGB → blur (radius proporsional) → mask kulit.
  const reg = new Uint8ClampedArray(bw * bh * 4);
  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const si = ((b.y0 + yy) * w + (b.x0 + xx)) * 4;
      const ri = (yy * bw + xx) * 4;
      reg[ri] = src[si];
      reg[ri + 1] = src[si + 1];
      reg[ri + 2] = src[si + 2];
      reg[ri + 3] = src[si + 3];
    }
  }
  const blurR = Math.max(1, Math.round(Math.min(bw, bh) * 0.02));
  const blurred = boxBlur(reg, bw, bh, blurR);

  const mask = new Float32Array(bw * bh);
  if (box) {
    for (let yy = 0; yy < bh; yy++) {
      for (let xx = 0; xx < bw; xx++) {
        const ri = (yy * bw + xx) * 4;
        mask[yy * bw + xx] = isSkinLike(reg[ri], reg[ri + 1], reg[ri + 2]) ? 1 : 0;
      }
    }
    const featherR = Math.max(1, Math.round(Math.min(bw, bh) * 0.03));
    const feathered = boxBlurMask(mask, bw, bh, featherR);
    mask.set(feathered);
  }

  // Tanpa wajah: pemulusan dimatikan, koreksi lebih lembut.
  const noFace = !box;
  const effSmooth = noFace ? 0 : smoothAmt;
  const effColor = noFace ? colorAmt * 0.5 : colorAmt;
  const effSharpen = noFace ? sharpenAmt * 0.6 : sharpenAmt;
  const effFactor = 1 + (stretch.cf - 1) * effColor;

  for (let yy = 0; yy < bh; yy++) {
    for (let xx = 0; xx < bw; xx++) {
      const si = ((b.y0 + yy) * w + (b.x0 + xx)) * 4;
      const ri = (yy * bw + xx) * 4;
      const m = noFace ? 0 : mask[yy * bw + xx];
      for (let c = 0; c < 3; c++) {
        const orig = src[si + c];
        let v = orig;
        // Pemulusan kulit (fading oleh mask, hanya di dalam kotak wajah).
        v += (blurred[ri + c] - orig) * effSmooth * m;
        // Koreksi warna/kontras (histogram) di kotak wajah.
        v = (v - 128) * effFactor + 128 + stretch.bAdd * effColor * 0.6;
        // Ketajaman unsharp — lebih kuat di non-kulit (mata, alis, rambut).
        if (effSharpen > 0) {
          const sm = 1 - 0.55 * m;
          v += (v - blurred[ri + c]) * effSharpen * sm;
        }
        out[si + c] = clamp255(v);
      }
      out[si + 3] = src[si + 3];
    }
  }

  // Latar: koreksi warna lembut di luar kotak (CodeFormer: background enhancement).
  if (box && params.background && effColor > 0) {
    const bgFactor = 1 + (stretch.cf - 1) * effColor * 0.45;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) continue;
        const i = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const v = out[i + c];
          out[i + c] = clamp255(
            (v - 128) * bgFactor + 128 + stretch.bAdd * effColor * 0.3
          );
        }
      }
    }
  }

  // Pemulihan warna global (saturasi + hangat) untuk foto pudar / hitam-putih.
  if (params.restoreColor) {
    for (let i = 0; i < out.length; i += 4) {
      if (out[i + 3] === 0) continue;
      restoreColorAt(out, i);
    }
  }

  return out;
}

type ImageSource = HTMLImageElement | HTMLCanvasElement;

function sourceSize(source: ImageSource): [number, number] {
  return source instanceof HTMLImageElement
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];
}

/**
 * Jalankan pemulihan wajah pada sumber gambar. `maxSize` = batas sisi
 * terpanjang kanvas hasil (0 = ukuran asli penuh). `upscale` = faktor
 * perbesaran setelah pemulihan (1/2/4).
 *
 * Urutan pipeline mengikuti CodeFormer yang mengintegrasikan Real-ESRGAN:
 * **restore dulu, upscale kemudian** — pemulihan mengembalikan informasi
 * wajah yang hilang, lalu perbesaran memperbesar hasilnya dengan tajam.
 * (Memperbesar dulu hanya membesarkan piksel rusak; informasi wajah yang
 * hilang tidak kembali dengan sendirinya.)
 */
export function enhanceFace(
  source: ImageSource,
  params: FaceEnhanceParams,
  maxSize = 0,
  upscale = 1
): HTMLCanvasElement {
  const [srcW, srcH] = sourceSize(source);
  const scale = maxSize > 0 ? Math.min(1, maxSize / Math.max(srcW, srcH)) : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D tidak tersedia.");
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const face = detectFace(source);
  const box = computeFaceBox(face, w, h);
  const stretch = computeStretch(img.data, w, box ?? { x0: 0, y0: 0, x1: w, y1: h });
  const out = enhancePixels(img.data, w, h, box, params, stretch);

  // Salinan eksplisit agar buffer ber-backing ArrayBuffer (bukan
  // ArrayBufferLike) — kontrak ImageData di lib DOM modern.
  ctx.putImageData(new ImageData(new Uint8ClampedArray(out), w, h), 0, 0);

  // Perbesaran (Real-ESRGAN-style) diterapkan SETELAH pemulihan.
  const factor = Math.max(1, Math.round(upscale));
  if (factor > 1) {
    // upscaleCanvas memakai factory canvas default (HTMLCanvasElement) di
    // thread utama — hasilnya aman di-cast.
    return upscaleCanvas(canvas, factor) as HTMLCanvasElement;
  }
  return canvas;
}

/** Saran parameter dari analisis kotak wajah: bentangan kontras dari
 *  histogram + deteksi foto hitam-putih (saturasi rendah → restoreColor). */
export function autoFaceParams(source: ImageSource): FaceEnhanceParams {
  const [srcW, srcH] = sourceSize(source);
  const scale = Math.min(1, 360 / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { ...NEUTRAL_PARAMS };
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const face = detectFace(source);
  const box = computeFaceBox(face, w, h) ?? { x0: 0, y0: 0, x1: w, y1: h };
  const stretch = computeStretch(img.data, w, box);

  // Saturasi rata-rata di kotak wajah → deteksi hitam-putih/foto pudar.
  let satSum = 0;
  let n = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const i = (y * w + x) * 4;
      const max = Math.max(img.data[i], img.data[i + 1], img.data[i + 2]);
      const min = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
      satSum += max === 0 ? 0 : (max - min) / max;
      n++;
    }
  }
  const sat = n > 0 ? satSum / n : 0.5;

  // Bentangan persentil → kekuatan koreksi warna.
  const color = Math.min(
    100,
    Math.max(20, Math.round(((stretch.cf - 1) / 1.6) * 100) + 25)
  );
  return {
    ...NEUTRAL_PARAMS,
    color,
    restoreColor: sat < 0.12,
  };
}
