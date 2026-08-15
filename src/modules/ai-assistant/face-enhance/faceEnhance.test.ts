import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeFaceBox,
  computeStretch,
  enhanceFace,
  enhancePixels,
  NEUTRAL_PARAMS,
  type FaceEnhanceParams,
} from "./faceEnhance";

describe("computeFaceBox — kotak wajah piksel dengan padding", () => {
  it("padding 30% di tiap sisi kotak deteksi (ter-clamp ke kanvas)", () => {
    const box = computeFaceBox(
      { x: 0.3, y: 0.3, w: 0.2, h: 0.2, area: 1 },
      100,
      200
    );
    // Padding 30% tiap sisi: lebar ≈ 0.2*100 + 2*(0.06*100) = 32 (±1 float).
    expect(box).not.toBeNull();
    expect(box!.x1 - box!.x0).toBeGreaterThanOrEqual(31);
    expect(box!.x1 - box!.x0).toBeLessThanOrEqual(33);
    expect(box!.y1 - box!.y0).toBeGreaterThanOrEqual(63);
    expect(box!.y1 - box!.y0).toBeLessThanOrEqual(65);
    // Terpusat pada kotak deteksi (0.3..0.5): pusat ≈ 40 x / 80 y (±2).
    expect((box!.x0 + box!.x1) / 2).toBeGreaterThanOrEqual(38);
    expect((box!.x0 + box!.x1) / 2).toBeLessThanOrEqual(42);
    expect((box!.y0 + box!.y1) / 2).toBeGreaterThanOrEqual(78);
    expect((box!.y0 + box!.y1) / 2).toBeLessThanOrEqual(82);
  });

  it("null → null (tanpa wajah)", () => {
    expect(computeFaceBox(null, 100, 200)).toBeNull();
  });

  it("kotak di tepi tidak melewati batas kanvas (clamp)", () => {
    const box = computeFaceBox(
      { x: 0.97, y: 0.97, w: 0.05, h: 0.05, area: 1 },
      100,
      100
    );
    expect(box!.x1).toBe(100);
    expect(box!.y1).toBe(100);
    expect(box!.x0).toBeGreaterThanOrEqual(0);
    expect(box!.y0).toBeGreaterThanOrEqual(0);
  });
});

describe("computeStretch — bentangan histogram kotak wajah", () => {
  it("gambar flat abu-abu 128 → cf ter-clamp (floor span) & bAdd 0 (identitas di 128)", () => {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 128;
      data[i + 1] = 128;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
    const s = computeStretch(data, w, { x0: 2, y0: 2, x1: 12, y1: 12 });
    // Rentang persentil = 0 → span di-floor ke 24 → cf = 255/24 = 2.6 (batas
    // aman), tapi bAdd = 0 sehingga abu-abu 128 tetap 128: tidak ada pergeseran.
    expect(s.cf).toBeCloseTo(2.6, 5);
    expect(s.bAdd).toBeCloseTo(0, 5);
    // Pemetaan (v-128)*cf+128 dengan v=128 → 128 (identitas di titik tengah).
    expect((128 - 128) * s.cf + 128).toBe(128);
  });

  it("gambar gelap → kontras & kecerahan naik", () => {
    const w = 20;
    const h = 20;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 40;
      data[i + 1] = 40;
      data[i + 2] = 40;
      data[i + 3] = 255;
    }
    const s = computeStretch(data, w, { x0: 0, y0: 0, x1: w, y1: h });
    expect(s.cf).toBeGreaterThan(1);
    expect(s.bAdd).toBeGreaterThan(0);
  });
});

describe("enhancePixels — pipeline murni", () => {
  const W = 40;
  const H = 40;
  /** Gambar dengan langkah keras di x=15 (kiri terang, kanan gelap) agar blur
   *  menghasilkan nilai berbeda dari aslinya. */
  function stepImage(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        data[i] = x < 15 ? 200 : 100;
        data[i + 1] = 160;
        data[i + 2] = 120;
        data[i + 3] = 255;
      }
    }
    return data;
  }

  const neutral = (): FaceEnhanceParams => ({
    ...NEUTRAL_PARAMS,
    fidelity: 100,
    smooth: 0,
    sharpen: 0,
    color: 0,
    background: false,
    restoreColor: false,
  });

  it("netral (w=100, semua 0) = identitas byte-ke-byte", () => {
    const src = stepImage();
    const out = enhancePixels(
      src,
      W,
      H,
      { x0: 10, y0: 10, x1: 20, y1: 20 },
      neutral(),
      { cf: 2.2, bAdd: 15 }
    );
    expect(out).toEqual(src);
  });

  it("piksel di luar kotak wajah tidak berubah tanpa background/restoreColor", () => {
    const src = stepImage();
    const out = enhancePixels(
      src,
      W,
      H,
      { x0: 10, y0: 10, x1: 20, y1: 20 },
      { ...neutral(), fidelity: 0, smooth: 100, sharpen: 100, color: 100 },
      { cf: 2.2, bAdd: 15 }
    );
    expect([out[0], out[1], out[2]]).toEqual([src[0], src[1], src[2]]);
    expect([out[(39 * W + 39) * 4], out[(39 * W + 39) * 4 + 1]]).toEqual([
      src[(39 * W + 39) * 4],
      src[(39 * W + 39) * 4 + 1],
    ]);
  });

  it("pemulusan + w rendah mengubah piksel kulit di dalam kotak", () => {
    const src = stepImage();
    const out = enhancePixels(
      src,
      W,
      H,
      { x0: 10, y0: 10, x1: 20, y1: 20 },
      { ...neutral(), fidelity: 0, smooth: 100, sharpen: 0, color: 0 },
      { cf: 1, bAdd: 0 }
    );
    // Piksel kulit di x=14 (200,160,120) — ter-blur dengan tetangga kanan gelap.
    const i = (14 * W + 14) * 4;
    expect([out[i], out[i + 1], out[i + 2]]).not.toEqual([200, 160, 120]);
  });

  it("tanpa wajah (box null): koreksi lembut global, alpha dipertahankan", () => {
    const src = stepImage();
    const out = enhancePixels(
      src,
      W,
      H,
      null,
      { ...neutral(), fidelity: 0, smooth: 100, sharpen: 60, color: 80, background: true },
      { cf: 2, bAdd: 10 }
    );
    // Ada perubahan di suatu tempat, tapi tidak menghilangkan isi.
    let changed = 0;
    for (let i = 0; i < src.length; i += 4) {
      if (out[i] !== src[i] || out[i + 1] !== src[i + 1] || out[i + 2] !== src[i + 2]) {
        changed++;
      }
      expect(out[i + 3]).toBe(src[i + 3]);
    }
    expect(changed).toBeGreaterThan(0);
  });
});

describe("enhanceFace — urutan restore → upscale (CodeFormer → Real-ESRGAN)", () => {
  /** Harness canvas minimal (pola waifu2x.test.ts): document.createElement
   *  mengembalikan canvas mock; getImageData datar (bukan kulit → tanpa
   *  wajah, jalur koreksi global). */
  function makeCanvasMock() {
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray(4096).fill(128), // 32×32 RGBA datar
    }));
    const canvases: Array<{ width: number; height: number }> = [];
    const createElement = vi.fn(() => {
      const c: { width: number; height: number; getContext: () => unknown } = {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage,
          putImageData,
          getImageData,
          createLinearGradient: () => ({ addColorStop: () => {} }),
        }),
      };
      canvases.push(c);
      return c;
    }) as unknown as ReturnType<typeof vi.fn>;
    return { createElement, drawImage, putImageData, getImageData, canvases };
  }

  class MockImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }

  let h: ReturnType<typeof makeCanvasMock>;
  beforeEach(() => {
    h = makeCanvasMock();
    vi.stubGlobal("document", { createElement: h.createElement });
    vi.stubGlobal("ImageData", MockImageData);
    vi.stubGlobal("HTMLImageElement", class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SRC = {
    width: 40,
    height: 40,
    naturalWidth: 40,
    naturalHeight: 40,
  } as unknown as HTMLCanvasElement;
  const P = { ...NEUTRAL_PARAMS, fidelity: 60 };

  it("upscale 2× → hasil dua kali dimensi sumber (restore lalu perbesar)", () => {
    const result = enhanceFace(SRC, P, 0, 2);
    expect(result.width).toBe(80);
    expect(result.height).toBe(80);
    // Sumber digambar dulu (restore), lalu kanvas hasil di-perbesar.
    expect(h.drawImage.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.drawImage.mock.calls[0][0]).toBe(SRC);
  });

  it("upscale 4× → 4× dimensi (bertahap 40→80→160)", () => {
    const result = enhanceFace(SRC, P, 0, 4);
    expect(result.width).toBe(160);
    expect(result.height).toBe(160);
  });

  it("default (tanpa upscale) → dimensi sumber, tidak ada langkah perbesaran", () => {
    const result = enhanceFace(SRC, P, 0);
    expect(result.width).toBe(40);
    expect(result.height).toBe(40);
    // drawImage hanya dari pemulihan (sumber) + deteksi wajah (sumber) —
    // tidak ada drawImage antar-kanvas (perbesaran).
    for (const call of h.drawImage.mock.calls) expect(call[0]).toBe(SRC);
  });

  it("preview (maxSize) tetap dibatasi meski upscale dipilih (pemanggil preview tidak meneruskan upscale)", () => {
    // maxSize < sumber → dibatasi; preview di index.tsx memanggil 3 argumen.
    const result = enhanceFace(SRC, P, 20);
    expect(result.width).toBe(20);
    expect(result.height).toBe(20);
  });

  it("restore benar-benar berjalan sebelum perbesaran (putImageData hasil restore terjadi)", () => {
    enhanceFace(SRC, P, 0, 2);
    // Hanya satu putImageData: hasil restore (sebelum upscale).
    expect(h.putImageData).toHaveBeenCalledTimes(1);
    // Satu-satunya drawImage antar-kanvas adalah perbesaran: sumbernya adalah
    // kanvas restore (canvases[0]) — bukan sumber foto.
    const upDraw = h.drawImage.mock.calls.find((c) => c[0] !== SRC);
    expect(upDraw).toBeDefined();
    expect(upDraw![0]).toBe(h.canvases[0]);
  });
});
