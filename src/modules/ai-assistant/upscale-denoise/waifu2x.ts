/**
 * Pemrosesan gambar gaya Waifu2x-Extension-GUI, sepenuhnya heuristik (tanpa
 * jaringan saraf): perbesaran resolusi (super-resolution via resize bertahap
 * berkualitas tinggi), pengurangan noise (median filter dengan level 0–3),
 * dan TTA (test-time augmentation) yang merata-rata 4 orientasi untuk
 * menghaluskan artefak arah — padanan perilaku default waifu2x.
 */

export type OutFormat = "png" | "webp" | "jpg";

export const DENOISE_LEVELS = [0, 1, 2, 3] as const;
export type DenoiseLevel = (typeof DENOISE_LEVELS)[number];

/** Radius & kekuatan median per level (level 0 = tanpa denoise). */
const DENOISE_MAP: Record<number, { radius: number; blend: number }> = {
  1: { radius: 1, blend: 1 },
  2: { radius: 1, blend: 1 },
  3: { radius: 2, blend: 1 },
};

/** Kanvas perantara pipeline — HTMLCanvasElement di thread utama,
 *  OffscreenCanvas di worker (API 2D yang dipakai identik). */
export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;

/** Pembuat kanvas perantara. Default membuat HTMLCanvasElement (thread
 *  utama); worker memanggil setCanvasFactory dengan OffscreenCanvas karena
 *  di sana tidak ada document.createElement. */
let createCanvas: (w: number, h: number) => CanvasLike = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** Ganti pembuat kanvas (dipakai worker: `new OffscreenCanvas(w, h)`). */
export function setCanvasFactory(fn: (w: number, h: number) => CanvasLike): void {
  createCanvas = fn;
}

/** Perbesar canvas ke dimensi target; bila >2x, resize bertahap agar
 *  interpolasi tidak menimbulkan jaggies (kualitas lebih baik dari sekali draw). */
export function upscaleCanvas(
  src: CanvasLike,
  scale: number
): CanvasLike {
  const targetW = Math.max(1, Math.round(src.width * scale));
  const targetH = Math.max(1, Math.round(src.height * scale));

  const step = (from: CanvasLike, w: number, h: number) => {
    const c = createCanvas(w, h);
    const x = c.getContext("2d")!;
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(from, 0, 0, w, h);
    return c;
  };

  let cur = src;
  let w = src.width;
  let h = src.height;
  // Gandakan bertahap hingga mendekati target (maks 2x per langkah).
  while (w * 2 <= targetW && h * 2 <= targetH) {
    cur = step(cur, w * 2, h * 2);
    w *= 2;
    h *= 2;
  }
  if (w !== targetW || h !== targetH) cur = step(cur, targetW, targetH);
  return cur;
}

/** Median filter per kanal (radius 1 = 3×3, radius 2 = 5×5) — mengurangi
 *  noise sambil menjaga tepi lebih baik daripada blur biasa. */
export function denoiseCanvas(
  src: CanvasLike,
  level: DenoiseLevel
): CanvasLike {
  const { radius, blend } = DENOISE_MAP[level] ?? { radius: 0, blend: 0 };
  if (radius === 0) return src;

  const ctx = src.getContext("2d")!;
  const { width, height } = src;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const out = new Uint8ClampedArray(data.length);
  const winSize = (radius * 2 + 1) ** 2;
  const mid = winSize >> 1;

  const r = new Uint8Array(winSize);
  const g = new Uint8Array(winSize);
  const b = new Uint8Array(winSize);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let k = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx));
          const i = (yy * width + xx) * 4;
          r[k] = data[i];
          g[k] = data[i + 1];
          b[k] = data[i + 2];
          k++;
        }
      }
      // Sortir kecil (9/25 elemen) — cukup cepat & stabil.
      r.sort();
      g.sort();
      b.sort();
      const o = (y * width + x) * 4;
      out[o] = Math.round(data[o] * (1 - blend) + r[mid] * blend);
      out[o + 1] = Math.round(data[o + 1] * (1 - blend) + g[mid] * blend);
      out[o + 2] = Math.round(data[o + 2] * (1 - blend) + b[mid] * blend);
      out[o + 3] = data[o + 3];
    }
  }
  const c = createCanvas(width, height);
  c.getContext("2d")!.putImageData(new ImageData(out, width, height), 0, 0);
  return c;
}

/** Rotasi 90° (kelipatan), lossless untuk kelipatan 90°. */
function rotate90(src: CanvasLike, quarters: number): CanvasLike {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return src;
  const swap = q % 2 === 1;
  const c = createCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const x = c.getContext("2d")!;
  x.translate(c.width / 2, c.height / 2);
  x.rotate((q * 90 * Math.PI) / 180);
  x.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Rata-rata beberapa canvas berukuran sama (untuk TTA). */
function averageCanvases(canvases: CanvasLike[]): CanvasLike {
  const { width, height } = canvases[0];
  const acc = new Float64Array(width * height * 4);
  for (const cv of canvases) {
    const d = cv.getContext("2d")!.getImageData(0, 0, width, height).data;
    for (let i = 0; i < d.length; i++) acc[i] += d[i];
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const n = canvases.length;
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(acc[i] / n);
  const c = createCanvas(width, height);
  c.getContext("2d")!.putImageData(new ImageData(out, width, height), 0, 0);
  return c;
}

export interface ProcessOptions {
  scale: number;
  denoise: DenoiseLevel;
  /** TTA: proses 4 orientasi lalu rata-rata (lebih halus, 4× lebih lambat). */
  tta: boolean;
}

/** Jalankan pipeline Waifu2x-lite: upscale → (denoise) → (TTA average). */
export function processImage(
  src: CanvasLike,
  { scale, denoise, tta }: ProcessOptions
): HTMLCanvasElement {
  const angles = tta ? [0, 1, 2, 3] : [0];
  const variants = angles.map((a) => {
    const rot = rotate90(src, a);
    let c = upscaleCanvas(rot, scale);
    if (denoise > 0) c = denoiseCanvas(c, denoise);
    return rotate90(c, -a);
  });
  return variants.length > 1 ? averageCanvases(variants) : variants[0];
}

/** MIME untuk format output. */
function mimeOf(format: OutFormat): string {
  return format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

/** Encode canvas (HTML) ke blob sesuai format & kualitas (jpg/webp memakai quality). */
export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: OutFormat,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Gagal meng-encode gambar."));
      },
      mimeOf(format),
      quality
    );
  });
}

/** Encode canvas apa pun (HTML atau Offscreen) ke blob — worker memakai
 *  OffscreenCanvas.convertToBlob, thread utama canvas.toBlob. */
export function canvasLikeToBlob(
  c: CanvasLike,
  format: OutFormat,
  quality: number
): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: mimeOf(format), quality });
  return canvasToBlob(c, format, quality);
}

export interface FormatStat {
  format: OutFormat;
  size: number;
  /** PSNR terhadap kanvas asli (dB); null = lossless (PNG) atau gagal decode. */
  psnrDb: number | null;
}

/**
 * Bandingkan kualitas hasil antar format: encode kanvas yang sama ke
 * PNG/WebP/JPG, lalu hitung PSNR (Peak Signal-to-Noise Ratio) tiap versi
 * lossy terhadap kanvas asli. PNG (lossless) menjadi referensi ukuran.
 * Bila format tak didukung browser, entry tetap ada dengan size 0 / PSNR null.
 */
export async function compareFormats(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<FormatStat[]> {
  const src = canvas
    .getContext("2d")!
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const out: FormatStat[] = [];

  for (const fmt of ["png", "webp", "jpg"] as OutFormat[]) {
    try {
      const blob = await canvasToBlob(canvas, fmt, quality / 100);
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let mse = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const dr = src[i] - d[i];
        const dg = src[i + 1] - d[i + 1];
        const db = src[i + 2] - d[i + 2];
        mse += dr * dr + dg * dg + db * db;
      }
      mse /= n * 3;
      out.push({
        format: fmt,
        size: blob.size,
        psnrDb: mse === 0 ? null : 10 * Math.log10((255 * 255) / mse),
      });
    } catch {
      out.push({ format: fmt, size: 0, psnrDb: null });
    }
  }
  return out;
}

/** Memuat gambar dari URL/blob menjadi canvas (dimuat ke elemen Image). */
export function loadImageToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error("Gagal memuat gambar."));
    img.src = url;
  });
}
