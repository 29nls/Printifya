/**
 * Deteksi wajah ringan berbasis warna kulit (tanpa model ML / jaringan).
 *
 * Cara kerja:
 * 1. Gambar diskalakan kecil (maks 240 px) untuk kecepatan.
 * 2. Pixel diklasifikasikan sebagai "kulit" via aturan gabungan HSV + YCrCb.
 * 3. Komponen terhubung (connected components) dikumpulkan; region wajah
 *    dipilih dari komponen kulit terbesar yang tidak menyentuh tepi gambar,
 *    tidak terlalu pipih/lebar, dan cukup padat.
 *
 * Hasil dinormalisasi ke koordinat 0..1 dari gambar sumber sehingga tidak
 * bergantung pada ukuran tampilan. Cukup akurat untuk foto pas foto dengan
 * latar polos; bisa diganti dengan detektor berbasis ML (mis. MediaPipe)
 * tanpa mengubah pemanggil.
 */

export interface FaceRegion {
  /** Batas kotak wajah, ternormalisasi 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Luas komponen dalam piksel (pada skala deteksi). */
  area: number;
}

interface Component {
  x: number;
  y: number;
  w: number;
  h: number;
  area: number;
  density: number;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max / 255;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, v];
}

/** Klasifikasi warna kulit: gabungan rentang HSV dan YCrCb yang cukup longgar. */
export function isSkinLike(r: number, g: number, b: number): boolean {
  const [h, s, v] = rgbToHsv(r, g, b);
  // YCrCb (Rec.601) tanpa komponen Y.
  const cr = 0.5 * r - 0.419 * g - 0.081 * b + 128;
  const cb = -0.169 * r - 0.332 * g + 0.5 * b + 128;
  return (
    h <= 50 &&
    s >= 0.12 &&
    s <= 0.8 &&
    v >= 0.15 &&
    cr >= 130 &&
    cr <= 185 &&
    cb >= 90 &&
    cb <= 145
  );
}

interface ScanResult {
  components: Component[];
  minArea: number;
}

/** Kumpulkan komponen terhubung dari mask kulit (flood fill iteratif). */
function collectComponents(mask: Uint8Array, w: number, h: number): ScanResult {
  const minArea = w * h * 0.004; // abaikan bintik kecil
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const components: Component[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;

    stack.length = 0;
    stack.push(start);
    seen[start] = 1;

    let minX = start % w;
    let maxX = minX;
    let minY = (start / w) | 0;
    let maxY = minY;
    let area = 0;

    while (stack.length) {
      const p = stack.pop()!;
      const px = p % w;
      const py = (p / w) | 0;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      if (px > 0 && mask[p - 1] && !seen[p - 1]) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (px < w - 1 && mask[p + 1] && !seen[p + 1]) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (py > 0 && mask[p - w] && !seen[p - w]) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (py < h - 1 && mask[p + w] && !seen[p + w]) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }

    if (area < minArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    components.push({
      x: minX,
      y: minY,
      w: bw,
      h: bh,
      area,
      density: bw * bh > 0 ? area / (bw * bh) : 0,
    });
  }

  return { components, minArea };
}

/** Berapa sisi gambar yang disentuh kotak komponen (latar biasanya menyentuh 4 sisi). */
function countEdgeTouches(c: Component, w: number, h: number): number {
  let n = 0;
  if (c.x === 0) n++;
  if (c.y === 0) n++;
  if (c.x + c.w >= w) n++;
  if (c.y + c.h >= h) n++;
  return n;
}

/**
 * Deteksi region wajah pada gambar.
 * Mengembalikan null bila tidak ditemukan kandidat yang meyakinkan.
 */
export function detectFace(
  source: HTMLImageElement | HTMLCanvasElement
): FaceRegion | null {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!srcW || !srcH) return null;

  const MAX = 240;
  const scale = Math.min(1, MAX / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * scale));
  const h = Math.max(2, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  // Piksel sudah di-diskalakan ke ≤240 lewat canvas — downscale di fungsi
  // murni menjadi no-op, hasilnya sama persis dengan implementasi lama.
  return detectFaceFromPixels(data, w, h, MAX);
}

/** Downscale murni (area averaging per blok) ke sisi terpanjang ≤ `max`.
 *  Mengembalikan array yang sama bila tidak perlu diskalakan (tanpa salin). */
function downscalePixels(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  max: number
): { data: Uint8ClampedArray; w: number; h: number } {
  const scale = Math.min(1, max / Math.max(1, Math.max(w, h)));
  const dw = Math.max(2, Math.round(w * scale));
  const dh = Math.max(2, Math.round(h * scale));
  if (dw === w && dh === h) return { data, w, h };
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor((y * h) / dh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor((x * w) / dw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * w) / dw));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * w + sx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          a += data[i + 3];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { data: out, w: dw, h: dh };
}

/**
 * Deteksi wajah dari piksel mentah RGBA (tanpa DOM) — dipakai `detectFace`
 * (yang menyiapkan piksel via canvas) dan Web Worker pipeline video. Downscale
 * ke sisi terpanjang ≤ `max` (default 240) dilakukan di sini via area
 * averaging; hasil ternormalisasi 0..1 terhadap ukuran masukan.
 */
export function detectFaceFromPixels(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  max = 240
): FaceRegion | null {
  if (!data.length || w < 2 || h < 2) return null;
  const { data: scaled, w: dw, h: dh } = downscalePixels(data, w, h, max);

  const mask = new Uint8Array(dw * dh);
  for (let i = 0, p = 0; i < scaled.length; i += 4, p++) {
    mask[p] = isSkinLike(scaled[i], scaled[i + 1], scaled[i + 2]) ? 1 : 0;
  }

  const { components } = collectComponents(mask, dw, dh);

  let best: Component | null = null;
  for (const c of components) {
    const aspect = c.w / c.h;
    const touches = countEdgeTouches(c, dw, dh);
    // Latar menyentuh tepi; wajah tidak. Tolak bentuk ekstrem & komponen jarang.
    if (touches > 2 || aspect > 2.2 || aspect < 0.25 || c.density < 0.2) {
      continue;
    }
    if (!best || c.area > best.area) best = c;
  }

  if (!best) return null;
  return {
    x: best.x / dw,
    y: best.y / dh,
    w: best.w / dw,
    h: best.h / dh,
    area: best.area,
  };
}
