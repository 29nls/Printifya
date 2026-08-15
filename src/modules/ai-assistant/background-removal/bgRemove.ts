/**
 * Penghapusan latar belakang heuristik (tanpa model ML / jaringan),
 * konsisten dengan pendekatan deteksi wajah di shared/faceDetect.ts:
 * klasifikasi warna kulit dipakai untuk menghentikan penyebaran latar
 * (kulit selalu dianggap bagian subjek).
 *
 * Perilaku meniru rembg (https://github.com/danielgatis/rembg) sejauh bisa
 * tanpa jaringan saraf:
 * - Segmen subjek → mask alpha (rembg `remove`),
 * - `--post-process-mask` → opening morfologi (erode → dilate 3×3) untuk
 *   membersihkan bintik & menyambung tepi mask,
 * - `-a / --alpha-matting` + `--alpha-matting-erode-size` (default 10) →
 *   mask subjek di-erosi dulu sebelum feathering, memberi tepi yang lebih
 *   halus pada band transisi,
 * - `-om / --only-mask` → kanvas mask grayscale resolusi penuh ikut
 *   dikembalikan untuk diekspor (putih = subjek),
 * - `--bgcolor` → penggantian latar dengan warna polos via
 *   {@link applyBackgroundColor}.
 *
 * Cara kerja:
 * 1. Gambar diskalakan kecil (maks 700 px) untuk kecepatan.
 * 2. Warna latar disampling dari piksel tepi (non-kulit), dikuantisasi
 *    menjadi palet kecil (maks 5 warna dominan).
 * 3. Flood fill dari seluruh tepi: piksel yang terhubung, bukan kulit, dan
 *    warnanya dekat dengan palet latar diklaim sebagai latar.
 * 4. Mask subjek di-post-proses / di-erosi sesuai opsi, lalu diskalakan naik
 *    ke resolusi asli dengan smoothing (feathering) untuk tepi lembut.
 */

import { isSkinLike } from "../../photo-studio/shared/faceDetect";

export interface RemoveBgOptions {
  /** Opening morfologi pada mask (padanan rembg `--post-process-mask`). */
  postProcess?: boolean;
  /** Alpha matting: erosi mask sebelum feathering (padanan rembg `-a`). */
  alphaMatting?: boolean;
  /** Ukuran erosi mask dalam px skala pemrosesan; rembg default 10. */
  erodeSize?: number;
}

export interface BgProcessResult {
  /** Kanvas hasil dengan latar transparan, ukuran penuh gambar sumber. */
  canvas: HTMLCanvasElement;
  /** Mask grayscale resolusi penuh (putih = subjek) untuk ekspor mask (-om). */
  mask: HTMLCanvasElement;
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

/** Erosi mask biner (1 = subjek) dengan kernel 3×3, `iterations` kali. */
function erodeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  iterations: number
): Uint8Array {
  let m: Uint8Array = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!m[p]) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              ok = false;
              break;
            }
            if (!m[ny * w + nx]) {
              ok = false;
              break;
            }
          }
        }
        if (ok) out[p] = 1;
      }
    }
    m = out;
  }
  return m;
}

/** Dilatasi mask biner (1 = subjek) dengan kernel 3×3, `iterations` kali. */
function dilateMask(
  mask: Uint8Array,
  w: number,
  h: number,
  iterations: number
): Uint8Array {
  let m: Uint8Array = mask;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (m[p]) {
          out[p] = 1;
          continue;
        }
        for (let dy = -1; dy <= 1 && !out[p]; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) {
              out[p] = 1;
              break;
            }
          }
        }
      }
    }
    m = out;
  }
  return m;
}

/** Opening morfologi (erode → dilate) — padanan rembg `post_process_mask`. */
function postProcessMask(
  mask: Uint8Array,
  w: number,
  h: number
): Uint8Array {
  return dilateMask(erodeMask(mask, w, h, 1), w, h, 1);
}

/**
 * Hapus latar belakang. Mengembalikan kanvas transparan berukuran penuh,
 * mask grayscale (putih = subjek), dan rasio subjek. Opsi meniru rembg:
 * `postProcess` (--post-process-mask), `alphaMatting` + `erodeSize`
 * (-a / --alpha-matting-erode-size, default 10).
 */
export function removeBackground(
  source: HTMLImageElement | HTMLCanvasElement,
  opts: RemoveBgOptions = {}
): BgProcessResult {
  const srcW =
    source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const srcH =
    source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  if (!srcW || !srcH) throw new Error("Gambar kosong.");

  const postProcess = opts.postProcess ?? false;
  const alphaMatting = opts.alphaMatting ?? false;
  const erodeSize = Math.max(0, Math.round(opts.erodeSize ?? 10));

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

  // Mask subjek (1 = subjek) pada skala kecil.
  let fg: Uint8Array = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) fg[p] = bg[p] ? 0 : 1;

  // Post-proses mask (rembg --post-process-mask): buang bintik, rapi tepi.
  if (postProcess) fg = postProcessMask(fg, w, h);

  // Alpha matting (rembg -a): erosi mask sebelum feathering → tepi lebih halus.
  if (alphaMatting && erodeSize > 0) fg = erodeMask(fg, w, h, erodeSize);

  let fgCount = 0;
  const maskSmall = document.createElement("canvas");
  maskSmall.width = w;
  maskSmall.height = h;
  const mctx = maskSmall.getContext("2d");
  if (!mctx) throw new Error("Canvas tidak didukung browser ini.");
  const maskData = mctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    const v = fg[p] ? 255 : 0;
    if (fg[p]) fgCount++;
    maskData.data[p * 4] = v;
    maskData.data[p * 4 + 1] = v;
    maskData.data[p * 4 + 2] = v;
    maskData.data[p * 4 + 3] = v;
  }
  mctx.putImageData(maskData, 0, 0);

  // Mask resolusi penuh: diskalakan naik dengan smoothing (feathering).
  const mask = document.createElement("canvas");
  mask.width = srcW;
  mask.height = srcH;
  const mfctx = mask.getContext("2d");
  if (!mfctx) throw new Error("Canvas tidak didukung browser ini.");
  mfctx.imageSmoothingEnabled = true;
  mfctx.imageSmoothingQuality = "high";
  mfctx.drawImage(maskSmall, 0, 0, srcW, srcH);

  // Hasil ukuran penuh: gambar asli dikomposit dengan alpha dari mask.
  const full = document.createElement("canvas");
  full.width = srcW;
  full.height = srcH;
  const fctx = full.getContext("2d");
  if (!fctx) throw new Error("Canvas tidak didukung browser ini.");
  fctx.drawImage(source, 0, 0, srcW, srcH);
  fctx.globalCompositeOperation = "destination-in";
  fctx.drawImage(mask, 0, 0);
  fctx.globalCompositeOperation = "source-over";

  return {
    canvas: full,
    mask,
    foregroundRatio: fgCount / (w * h),
  };
}

/** Ganti latar transparan dengan warna polos (hex, mis. "#ffffff") — rembg --bgcolor. */
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
