/**
 * Peningkatan kualitas foto berbasis histogram — tanpa model ML / jaringan.
 *
 * - `computeAutoParams`: menganalisis histogram luminance (persentil 1% & 99%)
 *   untuk menyarankan nilai Kecerahan & Kontras yang membentangkan rentang
 *   gambar ke hampir penuh, plus Ketajaman awal yang halus.
 * - `enhanceImage`: pipeline piksel Kecerahan (aditif) → Kontras (linear di
 *   sekitar 128) → Ketajaman (unsharp mask dengan box blur separable).
 *
 * Proses berjalan pada kanvas berukuran terbatas untuk pratinjau live dan
 * ukuran penuh untuk ekspor/unduh.
 */

export interface EnhanceParams {
  /** -100..100: pergeseran kecerahan (aditif, ±128 level). */
  brightness: number;
  /** -100..100: kontras di sekitar 128 (0 = netral). */
  contrast: number;
  /** 0..100: kekuatan ketajaman (unsharp mask). */
  sharpness: number;
}

export const NEUTRAL_PARAMS: EnhanceParams = {
  brightness: 0,
  contrast: 0,
  sharpness: 0,
};

type ImageSource = HTMLImageElement | HTMLCanvasElement;

function sourceSize(source: ImageSource): [number, number] {
  return source instanceof HTMLImageElement
    ? [source.naturalWidth, source.naturalHeight]
    : [source.width, source.height];
}

/** Faktor kontras dari nilai slider (-100..100). */
function contrastFactor(contrast: number): number {
  // ≥0: 1..3 ; <0: 1..0.5 (tidak pernah membalik).
  return contrast >= 0 ? 1 + contrast / 50 : 1 + contrast / 200;
}

/** Ambil ImageData dari sumber, diskalakan ke maks `maxSize` (0 = ukuran asli). */
function getImageDataScaled(
  source: ImageSource,
  maxSize: number
): { data: Uint8ClampedArray; w: number; h: number } {
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
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

/** Hitung persentil luminance (0..255) dari histogram kumulatif. */
function percentile(hist: Float64Array, total: number, p: number): number {
  const target = (total * p) / 100;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= target) return i;
  }
  return 255;
}

/**
 * Analisis histogram luminance lalu tentukan parameter awal yang baik.
 * Menyarankan nilai slider; pengguna bebas menyesuaikan setelahnya.
 */
export function computeAutoParams(source: ImageSource): EnhanceParams {
  const { data, w, h } = getImageDataScaled(source, 360);
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    );
    hist[Math.min(255, Math.max(0, lum))]++;
  }
  const total = w * h;
  const p01 = percentile(hist, total, 1);
  const p99 = percentile(hist, total, 99);
  const span = Math.max(16, p99 - p01);

  // Rentang 1%..99% dibentangkan ke hampir penuh (0..255).
  const contrast = Math.min(100, Math.round((255 / span - 1) * 55));
  // Titik tengah rentang digeser ke abu-abu 128.
  const mid = (p01 + p99) / 2;
  const brightness = Math.max(
    -100,
    Math.min(100, Math.round(((128 - mid) / 128) * 100))
  );

  return { brightness, contrast, sharpness: 30 };
}

/** Box blur separable (RGB; alpha disalin). O(w*h) per arah. */
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

  // Horizontal.
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
  // Vertikal.
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

/**
 * Jalankan pipeline peningkatan pada sumber.
 * `maxSize` = batas sisi terpanjang kanvas hasil (0 = ukuran asli penuh).
 */
export function enhanceImage(
  source: ImageSource,
  params: EnhanceParams,
  maxSize = 0
): HTMLCanvasElement {
  const { data, w, h } = getImageDataScaled(source, maxSize);
  const out = new Uint8ClampedArray(data.length);

  const cf = contrastFactor(params.contrast);
  const bAdd = params.brightness * 1.28;

  const sharpen = params.sharpness > 0;
  // Radius unsharp proporsional terhadap skala gambar agar efek konsisten
  // antara pratinjau kecil dan hasil ukuran penuh.
  const [srcW] = sourceSize(source);
  const radius = Math.max(1, Math.round((w / Math.max(1, srcW)) * 4));
  const blur = sharpen ? boxBlur(data, w, h, radius) : null;
  const amount = (params.sharpness / 100) * 1.5;

  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = data[i + c] + bAdd; // kecerahan
      v = (v - 128) * cf + 128; // kontras
      if (blur) v = v + amount * (v - blur[i + c]); // ketajaman
      out[i + c] = Math.min(255, Math.max(0, v));
    }
    out[i + 3] = data[i + 3]; // alpha dipertahankan
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia.");
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return canvas;
}
