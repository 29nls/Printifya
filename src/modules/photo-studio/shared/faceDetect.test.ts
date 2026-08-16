import { describe, expect, it } from "vitest";
import { detectFaceFromPixels } from "./faceDetect";

/** Bangun buffer RGBA w×h; isi latar `bg`, lalu gambar elips kulit di tengah. */
function skinFaceImage(
  w: number,
  h: number,
  rx = w * 0.18,
  ry = h * 0.28
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  const bg = [90, 140, 220]; // biru (bukan kulit)
  const skin = [230, 170, 130]; // kulit (isSkinLike ✓)
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inEllipse =
        ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      const c = inEllipse ? skin : bg;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return data;
}

function flatImage(w: number, h: number, rgb: [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return data;
}

describe("detectFaceFromPixels — deteksi wajah murni (tanpa DOM)", () => {
  it("elips kulit di tengah → region ditemukan, terpusat, ternormalisasi 0..1", () => {
    const w = 200;
    const h = 240;
    const face = detectFaceFromPixels(skinFaceImage(w, h), w, h);
    expect(face).not.toBeNull();
    const cx = (face!.x + face!.w / 2) * w;
    const cy = (face!.y + face!.h / 2) * h;
    expect(cx).toBeGreaterThan(w * 0.35);
    expect(cx).toBeLessThan(w * 0.65);
    expect(cy).toBeGreaterThan(h * 0.35);
    expect(cy).toBeLessThan(h * 0.65);
    expect(face!.x).toBeGreaterThanOrEqual(0);
    expect(face!.y).toBeGreaterThanOrEqual(0);
    expect(face!.x + face!.w).toBeLessThanOrEqual(1);
    expect(face!.y + face!.h).toBeLessThanOrEqual(1);
  });

  it("tanpa kulit → null", () => {
    expect(detectFaceFromPixels(flatImage(200, 240, [90, 140, 220]), 200, 240)).toBeNull();
  });

  it("komponen kulit menyentuh ≥3 tepi (latar) → ditolak → null", () => {
    const w = 100;
    const h = 100;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        // Separuh kiri kulit (menyentuh tepi kiri/atas/bawah → 3 tepi).
        const c = x < 40 ? [230, 170, 130] : [90, 140, 220];
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
    expect(detectFaceFromPixels(data, w, h)).toBeNull();
  });

  it("gambar besar di-downscale internal ke ≤240 (area averaging) — hasil tetap ditemukan", () => {
    const w = 960;
    const h = 540;
    const face = detectFaceFromPixels(skinFaceImage(w, h), w, h);
    expect(face).not.toBeNull();
    // Normalisasi ke ukuran masukan (0..1), bukan ukuran deteksi.
    expect(face!.x).toBeGreaterThan(0);
    expect(face!.x).toBeLessThan(1);
    expect((face!.x + face!.w / 2) * w).toBeGreaterThan(w * 0.3);
    expect((face!.x + face!.w / 2) * w).toBeLessThan(w * 0.7);
  });

  it("buffer tak valid (0×0) → null tanpa throw", () => {
    expect(detectFaceFromPixels(new Uint8ClampedArray(0), 0, 0)).toBeNull();
  });
});
