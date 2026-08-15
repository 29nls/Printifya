/**
 * Auto-crop ala leblancfg/autocrop (https://github.com/leblancfg/autocrop).
 *
 * Perilaku yang ditiru dari `autocrop/autocrop.py` (Cropper):
 * 1. Deteksi wajah TERBESAR pada gambar (di sini memakai `detectFace` yang
 *    sudah ada — deteksi berbasis warna kulit, bukan YuNet/OpenCV).
 * 2. Kotak crop dihitung TERPUSAT pada wajah dengan rasio aspek output dan
 *    zoom = `facePercent` (default 50 → wajah mengisi 50% tinggi hasil),
 *    memakai "safe zoom": zoom dinaikkan (crop mengecil) bila kotak ideal
 *    akan keluar dari gambar, sehingga crop selalu muat di dalam gambar.
 * 3. Kotak digeser (shift) bila perlu agar tetap di dalam batas gambar,
 *    lalu di-resize ke ukuran output persis (width × height) px.
 * 4. Bila tidak ada wajah → tidak ada hasil (null), sama seperti
 *    `Cropper.crop()` yang mengembalikan None.
 */

import { detectFace } from "../../photo-studio/shared/faceDetect";

export interface AutoCropResult {
  /** Data URL PNG hasil crop (persis outW × outH px). */
  dataUrl: string;
  /** Kotak crop dalam piksel gambar sumber. */
  box: { x: number; y: number; w: number; h: number };
  /** Zoom (face percent) yang benar-benar dipakai. */
  zoom: number;
}

type Vec = [number, number];

function perp(a: Vec): Vec {
  return [-a[1], a[0]];
}

/** Titik potong dua garis (masing-masing lewat dua titik). null bila sejajar. */
function lineIntersect(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const da: Vec = [a2[0] - a1[0], a2[1] - a1[1]];
  const db: Vec = [b2[0] - b1[0], b2[1] - b1[1]];
  const dp: Vec = [a1[0] - b1[0], a1[1] - b1[1]];
  const dap = perp(da);
  const denom = dap[0] * db[0] + dap[1] * db[1];
  if (denom === 0) return null;
  const t = (dap[0] * dp[0] + dap[1] * dp[1]) / denom;
  return [b1[0] + t * db[0], b1[1] + t * db[1]];
}

function dist(p1: Vec, p2: Vec): number {
  return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
}

/**
 * Translasi `_determine_safe_zoom` autocrop: zoom awal = facePercent, lalu
 * dinaikkan bila crop terpusat pada wajah akan keluar dari gambar — crop
 * akhir selalu berada di dalam gambar.
 */
function determineSafeZoom(
  imgW: number,
  imgH: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
  facePercent: number
): number {
  const corners: Vec[] = [
    [fx, fy],
    [fx + fw, fy],
    [fx, fy + fh],
    [fx + fw, fy + fh],
  ];
  const center: Vec = [fx + fw / 2, fy + fh / 2];
  const imgCorners: Vec[] = [
    [0, 0],
    [0, imgH],
    [imgW, imgH],
    [imgW, 0],
    [0, 0],
  ];
  const sides: [Vec, Vec][] = [];
  for (let n = 0; n < 4; n++) sides.push([imgCorners[n], imgCorners[n + 1]]);

  let zoom = facePercent;
  for (const c of corners) {
    const a = dist(center, c);
    for (const [s1, s2] of sides) {
      const pt = lineIntersect(center, c, s1, s2);
      if (!pt || !Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
      if (pt[0] >= 0 && pt[0] <= imgW && pt[1] >= 0 && pt[1] <= imgH) {
        const d = dist(center, pt);
        if (d > 0) zoom = Math.max(zoom, (100 * a) / d);
      }
    }
  }
  return zoom;
}

export interface CropBox {
  x: number;
  y: number;
  w: number;
  h: number;
  zoom: number;
}

/**
 * Posisi crop terpusat pada wajah (translasi `_crop_positions` autocrop).
 * Kotak memakai rasio aspek output (jadi resize tidak mendistorsi) dan
 * digeser agar muat di dalam gambar bila perlu.
 */
export function computeCropBox(
  imgW: number,
  imgH: number,
  face: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
  facePercent: number
): CropBox {
  const aspect = outW / outH;
  const zoom = determineSafeZoom(
    imgW,
    imgH,
    face.x,
    face.y,
    face.w,
    face.h,
    facePercent
  );

  let widthCrop: number;
  let heightCrop: number;
  if (outH >= outW) {
    heightCrop = (face.h * 100) / zoom;
    widthCrop = aspect * heightCrop;
  } else {
    widthCrop = (face.w * 100) / zoom;
    heightCrop = widthCrop / aspect;
  }

  const xpad = (widthCrop - face.w) / 2;
  const ypad = (heightCrop - face.h) / 2;
  let h1 = face.x - xpad;
  let h2 = face.x + face.w + xpad;
  let v1 = face.y - ypad;
  let v2 = face.y + face.h + ypad;

  // Geser kotak agar tetap di dalam gambar (perilaku autocrop).
  if (h1 < 0) {
    h2 -= h1;
    h1 = 0;
  }
  if (h2 > imgW) {
    h1 -= h2 - imgW;
    h2 = imgW;
  }
  if (v1 < 0) {
    v2 -= v1;
    v1 = 0;
  }
  if (v2 > imgH) {
    v1 -= v2 - imgH;
    v2 = imgH;
  }

  h1 = Math.max(0, h1);
  v1 = Math.max(0, v1);
  h2 = Math.min(imgW, h2);
  v2 = Math.min(imgH, v2);

  return { x: h1, y: v1, w: h2 - h1, h: v2 - v1, zoom };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar."));
    img.src = src;
  });
}

/**
 * Crop otomatis satu gambar: deteksi wajah terbesar → kotak crop terpusat →
 * resize persis ke (outW × outH) px. Mengembalikan null bila tidak ada wajah
 * atau kotak crop tidak valid (sama seperti autocrop yang mengembalikan None).
 */
export async function autoCropFace(
  src: string,
  outW: number,
  outH: number,
  facePercent: number
): Promise<AutoCropResult | null> {
  const img = await loadImage(src);
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  if (!imgW || !imgH) return null;

  const face = detectFace(img);
  if (!face) return null;

  const box = computeCropBox(
    imgW,
    imgH,
    { x: face.x * imgW, y: face.y * imgH, w: face.w * imgW, h: face.h * imgH },
    outW,
    outH,
    facePercent
  );
  if (box.w <= 0 || box.h <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);

  return { dataUrl: canvas.toDataURL("image/png"), box, zoom: box.zoom };
}
