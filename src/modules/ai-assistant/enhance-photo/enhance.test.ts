import { describe, expect, it } from "vitest";
import {
  enhancePixels,
  NEUTRAL_PARAMS,
  type EnhanceParams,
} from "./enhance";

/** Buat RGBA w×h dengan warna seragam. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return data;
}

describe("enhancePixels — inti murni pipeline Enhance Photo", () => {
  it("netral → identitas (piksel & alpha sama persis)", () => {
    const w = 16;
    const h = 12;
    const src = solid(w, h, 100, 150, 200);
    const out = enhancePixels(src, w, h, NEUTRAL_PARAMS);
    expect(out).toEqual(src);
  });

  it("kecerahan +50 → +64 level (aditif 1.28/100), ter-clamp 255", () => {
    const w = 8;
    const h = 8;
    const src = solid(w, h, 200, 100, 10);
    const out = enhancePixels(src, w, h, { brightness: 50, contrast: 0, sharpness: 0 });
    // 200 + 64 = 264 → clamp 255 ; 100 + 64 = 164 ; 10 + 64 = 74
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(164);
    expect(out[2]).toBe(74);
    expect(out[3]).toBe(255); // alpha tidak tersentuh
  });

  it("kontras +100 → faktor 3 di sekitar 128 (128 tetap 128)", () => {
    const w = 8;
    const h = 8;
    const src = solid(w, h, 128, 100, 156);
    const out = enhancePixels(src, w, h, { brightness: 0, contrast: 100, sharpness: 0 });
    expect(out[0]).toBe(128); // titik netral kontras
    // (100 - 128) * 3 + 128 = 44 ; (156 - 128) * 3 + 128 = 212
    expect(out[1]).toBe(44);
    expect(out[2]).toBe(212);
  });

  it("ketajaman > 0 mengubah piksel pada gambar non-uniform (unsharp mask)", () => {
    const w = 8;
    const h = 8;
    // Gradien horizontal terang→gelap supaya box blur menghasilkan perbedaan.
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = 255 - x * 20;
        src[i] = v;
        src[i + 1] = v;
        src[i + 2] = v;
        src[i + 3] = 255;
      }
    }
    const sharp = enhancePixels(src, w, h, { brightness: 0, contrast: 0, sharpness: 100 });
    const plain = enhancePixels(src, w, h, { brightness: 0, contrast: 0, sharpness: 0 });
    // Harus ada setidaknya satu piksel yang berubah (unsharp mask aktif).
    let changed = 0;
    for (let i = 0; i < src.length; i += 4) {
      if (sharp[i] !== plain[i]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("full-res (srcW = w) → radius unsharp 4, identik dengan jalur ekspor lama", () => {
    // Radius dihitung dari w / max(1, srcW) * 4; dengan srcW = w selalu 4.
    const w = 32;
    const h = 24;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < src.length; i += 4) {
      const x = (i / 4) % w;
      src[i] = (x * 7) % 256;
      src[i + 1] = 200;
      src[i + 2] = 60;
      src[i + 3] = 255;
    }
    const full = enhancePixels(src, w, h, { brightness: 30, contrast: 40, sharpness: 60 }, w);
    const sameW = enhancePixels(src, w, h, { brightness: 30, contrast: 40, sharpness: 60 });
    // Default srcW = w → kedua panggilan identik (default = full-res).
    expect(full).toEqual(sameW);
    // Nilai akhir ter-clamp 0..255, alpha dipertahankan.
    for (let i = 0; i < src.length; i += 4) {
      expect(full[i]).toBeGreaterThanOrEqual(0);
      expect(full[i]).toBeLessThanOrEqual(255);
      expect(full[i + 3]).toBe(255);
    }
  });

  it("alpha semi-transparan dipertahankan apa pun parameter", () => {
    const w = 4;
    const h = 4;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < src.length; i += 4) {
      src[i] = 10;
      src[i + 1] = 20;
      src[i + 2] = 30;
      src[i + 3] = 77; // alpha aneh — harus tetap 77
    }
    const out = enhancePixels(src, w, h, { brightness: 100, contrast: 100, sharpness: 100 });
    for (let i = 0; i < src.length; i += 4) {
      expect(out[i + 3]).toBe(77);
    }
  });

  it("gambar kosong (0×0) → hasil kosong tanpa throw", () => {
    const src = new Uint8ClampedArray(0);
    const out = enhancePixels(src, 0, 0, NEUTRAL_PARAMS);
    expect(out.length).toBe(0);
  });
});

describe("NEUTRAL_PARAMS — nilai default netral", () => {
  it("semua nol (tidak ada efek)", () => {
    const p: EnhanceParams = NEUTRAL_PARAMS;
    expect(p).toEqual({ brightness: 0, contrast: 0, sharpness: 0 });
  });
});
