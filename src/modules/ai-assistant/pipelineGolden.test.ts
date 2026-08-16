import { describe, expect, it } from "vitest";
import { enhancePixels as enhancePhotoPixels } from "./enhance-photo/enhance";
import { applyFaceEnhance } from "./face-enhance/faceEnhance";
import { NEUTRAL_PARAMS, processFramePixels } from "../shared/facePipeline";

/**
 * GOLDEN-IMAGE PINNING — inti piksel di balik semua jalur Web Worker.
 *
 * Parity worker ↔ fallback thread utama DIJAMIN by-construction: kedua jalur
 * memanggil inti murni yang SAMA (enhancePixels / applyFaceEnhance /
 * processFramePixels), hanya lokasi eksekusinya yang berbeda. Test ini
 * mengunci MATEMATIKA inti: gambar sintetis tetap + parameter tetap → hash
 * output eksak. Perubahan tak sengaja pada inti (angka ajaib, urutan operasi,
 * skala radius, clamp) akan memecah hash — drift perilaku terdeteksi tanpa
 * browser/Worker/DOM. (bg-removal tidak ikut: segmentasi `removeBackground`
 * berjalan di thread utama di KEDUA jalur, jadi tidak ada titik divergensi
 * worker/fallback pada level piksel; komposit/encode worker ter-verifikasi
 * browser.)
 */

/** FNV-1a 32-bit — hash deterministik byte output. */
function fnv1a(buf: Uint8ClampedArray): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** RGBA w×h dari fungsi per-piksel (0..255). */
function makeImage(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number]
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return data;
}

const W = 24;
const H = 18;

/** Gradien RGB miring (menyentuh blur/klamp). */
const gradient = makeImage(W, H, (x, y) => [
  Math.round((255 * x) / (W - 1)),
  Math.round((255 * y) / (H - 1)),
  Math.round((255 * (x + y)) / (W + H - 2)),
]);

/** Tepi keras vertikal: kiri gelap, kanan terang (menguji unsharp/blur). */
const hardEdge = makeImage(W, H, (x) =>
  x < W / 2 ? [20, 20, 20] : [235, 235, 235]
);

/** 4 blok warna kuadran (menguji koreksi warna/kontras). */
const colorBlocks = makeImage(W, H, (x, y) => {
  if (y < H / 2) return x < W / 2 ? [200, 40, 40] : [40, 200, 40];
  return x < W / 2 ? [40, 40, 200] : [128, 128, 128];
});

/** Patch warna kulit di tengah latar abu-abu (menguji mask kulit). */
const skinPatch = makeImage(W, H, (x, y) => {
  const inPatch = x >= 8 && x < 16 && y >= 6 && y < 12;
  return inPatch ? [220, 170, 140] : [120, 120, 120];
});

const ENHANCE_PARAMS = { brightness: 20, contrast: 35, sharpness: 60 };
const FACE_PARAMS = {
  fidelity: 70,
  smooth: 40,
  sharpen: 30,
  color: 60,
  background: true,
  restoreColor: true,
};
/** Region wajah sintetis (koordinat ternormalisasi) — deterministik. */
const FACE = { x: 0.35, y: 0.3, w: 0.3, h: 0.35, area: 120 };

const prev = makeImage(W, H, (x, y) => [
  Math.round((200 * x) / (W - 1)),
  100,
  Math.round((180 * y) / (H - 1)),
]);

describe("golden — enhancePixels (Enhance Photo)", () => {
  it("hash output pin: gradien, tepi keras, blok warna, preview kecil, netral", () => {
    const hashes = [
      enhancePhotoPixels(gradient, W, H, ENHANCE_PARAMS),
      enhancePhotoPixels(hardEdge, W, H, ENHANCE_PARAMS),
      enhancePhotoPixels(colorBlocks, W, H, ENHANCE_PARAMS),
      // srcW > w → radius unsharp diskalakan (jalur preview kecil).
      enhancePhotoPixels(gradient, W, H, ENHANCE_PARAMS, 400),
    ].map((r) => fnv1a(r));
    expect(hashes).toEqual([
      "1929214c",
      "6b28bfa5",
      "a9eaaae6",
      "c869b4a3",
    ]);
  });

  it("netral → identitas piksel (semantik pengunci, bukan hash)", () => {
    const src = hardEdge;
    expect(
      enhancePhotoPixels(src, W, H, { brightness: 0, contrast: 0, sharpness: 0 })
    ).toEqual(src);
  });
});

describe("golden — applyFaceEnhance (Face Enhance full-res)", () => {
  it("hash output pin: wajah+param kustom, tanpa wajah, wajah+netral", () => {
    const hashes = [
      applyFaceEnhance(skinPatch, W, H, FACE, FACE_PARAMS),
      applyFaceEnhance(skinPatch, W, H, null, FACE_PARAMS),
      applyFaceEnhance(hardEdge, W, H, FACE, NEUTRAL_PARAMS),
    ].map((r) => fnv1a(r));
    expect(hashes).toEqual(["eb676f05", "e0e1ee95", "494d4485"]);
  });
});

describe("golden — processFramePixels (video pipeline, face + temporal)", () => {
  it("hash output pin: baseline, blend temporal aktif, tanpa wajah", () => {
    const r1 = processFramePixels(skinPatch, W, H, FACE_PARAMS, 0, null);
    const r2 = processFramePixels(skinPatch, W, H, FACE_PARAMS, 50, prev);
    const r3 = processFramePixels(hardEdge, W, H, NEUTRAL_PARAMS, 30, prev);
    expect(fnv1a(r1.out)).toBe("5b4c81c5");
    expect(r1.faceDetected).toBe(true);
    expect(fnv1a(r2.out)).toBe("4123ce61");
    expect(r2.faceDetected).toBe(true);
    expect(fnv1a(r3.out)).toBe("53a3ff6e");
    expect(r3.faceDetected).toBe(false);
  });
});
