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
 * Bagian murni (tanpa DOM) kini hidup di `shared/facePipeline.ts` — sumber
 * bersama dengan Video Face Enhance — dan di-re-export dari sini agar
 * konsumen lama tetap berjalan: `computeFaceBox`, `computeStretch`,
 * `enhancePixels`, `NEUTRAL_PARAMS`. `enhanceFace` hanyalah pembungkus canvas.
 */

import { detectFace, type FaceRegion } from "../../photo-studio/shared/faceDetect";
import { upscaleCanvas } from "../upscale-denoise/waifu2x";
import {
  computeFaceBox,
  computeStretch,
  enhancePixels,
  NEUTRAL_PARAMS,
  type FaceEnhanceParams,
} from "../../shared/facePipeline";

export {
  computeFaceBox,
  computeStretch,
  enhancePixels,
  NEUTRAL_PARAMS,
  type FaceBoxPx,
  type FaceEnhanceParams,
  type StretchParams,
} from "../../shared/facePipeline";

type ImageSource = HTMLImageElement | HTMLCanvasElement;

/**
 * Inti pipeline restore pada piksel mentah (tanpa DOM): kotak wajah →
 * bentangan histogram → `enhancePixels`. SUMBER TUNGGAL logika restore —
 * dipakai `enhanceFace` (thread utama: pratinjau & fallback) DAN Web Worker
 * full-res (`faceEnhance.worker.ts`), jadi kedua jalur menghasilkan piksel
 * identik. `face` ternormalisasi 0..1 (null → koreksi global lembut).
 */
export function applyFaceEnhance(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  face: FaceRegion | null,
  params: FaceEnhanceParams
): Uint8ClampedArray {
  const box = computeFaceBox(face, w, h);
  const stretch = computeStretch(
    data,
    w,
    box ?? { x0: 0, y0: 0, x1: w, y1: h }
  );
  return enhancePixels(data, w, h, box, params, stretch);
}

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
  const out = applyFaceEnhance(img.data, w, h, face, params);

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
