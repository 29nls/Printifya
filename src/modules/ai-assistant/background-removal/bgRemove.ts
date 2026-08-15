/**
 * Penghapusan latar belakang heuristik (tanpa model ML / jaringan),
 * konsisten dengan pendekatan deteksi wajah di shared/faceDetect.ts:
 * klasifikasi warna kulit dipakai untuk menghentikan penyebaran latar
 * (kulit selalu dianggap bagian subjek).
 *
 * Cara kerja:
 * 1. Gambar diskalakan kecil (maks 700 px) untuk kecepatan.
 * 2. Warna latar disampling dari piksel tepi (non-kulit), dikuantisasi
 *    menjadi palet kecil (maks 5 warna dominan).
 * 3. Flood fill dari seluruh tepi: piksel yang terhubung, bukan kulit, dan
 *    warnanya dekat dengan palet latar diklaim sebagai latar.
 * 4. Mask latar diskalakan naik ke resolusi asli dengan smoothing, sehingga
 *    tepi subjek menjadi lembut (feathering) tanpa filter tambahan.
 *
 * Paling akurat untuk latar polos (putih/biru/merah — standar pas foto).
 * Bila latar rumit atau baju subjek sewarna latar, hasil bisa kurang sempurna.
 */

import { isSkinLike } from "../../photo-studio/shared/faceDetect";

export interface BgProcessResult {
  /** Kanvas hasil dengan latar transparan, ukuran penuh gambar sumber. */
  canvas: HTMLCanvasElement;
  /** Rasio piksel yang dipertahankan sebagai subjek (0..1). */
  foregroundRatio: number;
}

type RGB = [number, number, number];

/** Sampel warna tepi (non-kulit) lalu kuantisasi menjadi palet dominan. */
function buildPalette(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  skin: Uint8Array
): RGB[] {
  interface Bucket {
    count: number;
    r: number;
    g: number;
    b: number;
  }
  const buckets = new Map<number, Bucket>();
  const key = (r: number, g: number, b: number) =>
    ((r >> 5) << 10) | ((g >> 5) << 5) | (b >> 5);

  const add = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    if (skin[y * w + x]) return; // jangan jadikan kulit sebagai warna latar
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const k = key(r, g, b);
    const e = buckets.get(k);
    if (e) {
      e.count++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(k, { count: 1, r, g, b });
    }
  };

  for (let x = 0; x < w; x++) {
    add(x, 0);
    add(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    add(0, y);
    add(w - 1, y);
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((e) => [e.r / e.count, e.g / e.count, e.b / e.count]);
}

/** Flood fill dari tepi: klaim piksel yang terhubung, non-kulit, dekat palet latar. */
function floodFillBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  skin: Uint8Array,
  palette: RGB[]
): Uint8Array {
  const PALETTE_TOLERANCE = 90;
  const bg = new Uint8Array(w * h);

  const dist = (p: number, c: RGB) => {
    // data adalah array RGBA 4 kanal — indeks piksel p harus dikali 4.
    const dr = data[p * 4] - c[0];
    const dg = data[p * 4 + 1] - c[1];
    const db = data[p * 4 + 2] - c[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const nearestPalette = (p: number) => {
    let m = Infinity;
    for (const c of palette) {
      const d = dist(p, c);
      if (d < m) m = d;
    }
    return m;
  };

  const stack: number[] = [];
  const push = (p: number) => {
    if (!bg[p]) {
      bg[p] = 1;
      stack.push(p);
    }
  };

  // Benih: seluruh piksel tepi yang bukan kulit.
  for (let x = 0; x < w; x++) {
    if (!skin[x]) push(x);
    if (!skin[(h - 1) * w + x]) push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    if (!skin[y * w]) push(y * w);
    if (!skin[y * w + w - 1]) push(y * w + w - 1);
  }

  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p / w) | 0;
    const tryQ = (q: number) => {
      if (bg[q] || skin[q]) return;
      if (nearestPalette(q) < PALETTE_TOLERANCE) push(q);
    };
    if (x > 0) tryQ(p - 1);
    if (x < w - 1) tryQ(p + 1);
    if (y > 0) tryQ(p - w);
    if (y < h - 1) tryQ(p + w);
  }

  return bg;
}

/**
 * Hapus latar belakang. Mengembalikan kanvas transparan berukuran penuh.
 * Untuk mengganti latar dengan warna polos, pakai {@link applyBackgroundColor}.
 */
export function removeBackground(
  source: HTMLImageElement | HTMLCanvasElement
): BgProcessResult {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!srcW || !srcH) throw new Error("Gambar kosong.");

  const MAX = 700;
  const scale = Math.min(1, MAX / Math.max(srcW, srcH));
  const w = Math.max(2, Math.round(srcW * scale));
  const h = Math.max(2, Math.round(srcH * scale));

  const proc = document.createElement("canvas");
  proc.width = w;
  proc.height = h;
  const pctx = proc.getContext("2d", { willReadFrequently: true });
  if (!pctx) throw new Error("Canvas tidak didukung browser ini.");
  pctx.drawImage(source, 0, 0, w, h);
  const { data } = pctx.getImageData(0, 0, w, h);

  const skin = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    skin[p] = isSkinLike(data[i], data[i + 1], data[i + 2]) ? 1 : 0;
  }

  const palette = buildPalette(data, w, h, skin);
  const bg = floodFillBackground(data, w, h, skin, palette);

  // Mask subjek (putih = subjek) pada skala kecil.
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const mctx = maskCanvas.getContext("2d");
  if (!mctx) throw new Error("Canvas tidak didukung browser ini.");
  const maskData = mctx.createImageData(w, h);
  let fgCount = 0;
  for (let p = 0; p < w * h; p++) {
    const v = bg[p] ? 0 : 255;
    if (!bg[p]) fgCount++;
    maskData.data[p * 4] = v;
    maskData.data[p * 4 + 1] = v;
    maskData.data[p * 4 + 2] = v;
    // Alpha = mask (destination-in memakai alpha sumber, bukan RGB).
    maskData.data[p * 4 + 3] = v;
  }
  mctx.putImageData(maskData, 0, 0);

  // Hasil ukuran penuh: gambar asli dikomposit dengan alpha dari mask yang
  // diskalakan naik (smoothing memberi tepi lembut secara gratis).
  const full = document.createElement("canvas");
  full.width = srcW;
  full.height = srcH;
  const fctx = full.getContext("2d");
  if (!fctx) throw new Error("Canvas tidak didukung browser ini.");
  fctx.drawImage(source, 0, 0, srcW, srcH);
  fctx.globalCompositeOperation = "destination-in";
  fctx.imageSmoothingEnabled = true;
  fctx.imageSmoothingQuality = "high";
  fctx.drawImage(maskCanvas, 0, 0, srcW, srcH);
  fctx.globalCompositeOperation = "source-over";

  return {
    canvas: full,
    foregroundRatio: fgCount / (w * h),
  };
}

/** Ganti latar transparan dengan warna polos (hex, mis. "#ffffff"). */
export function applyBackgroundColor(
  result: HTMLCanvasElement,
  hex: string
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = result.width;
  out.height = result.height;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas tidak didukung browser ini.");
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(result, 0, 0);
  return out;
}
