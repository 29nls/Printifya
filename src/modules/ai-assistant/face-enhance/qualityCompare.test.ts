import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  comparePixels,
  comparePipelines,
  runFramePipeline,
} from "./qualityCompare";
import { processFramePixels } from "../../shared/facePipeline";
import { NEUTRAL_PARAMS, type FaceEnhanceParams } from "./faceEnhance";

// Spy pada processFramePixels (delegasi ke implementasi asli agar semua test
// lain tetap berperilaku identik) — membuktikan runFramePipeline mendelegasi
// penuh ke sumber tunggal jalur video, bukan menyalin pipeline.
vi.mock("../../shared/facePipeline", async (importOriginal) => {
  const mod = await importOriginal<
    typeof import("../../shared/facePipeline")
  >();
  return {
    ...mod,
    processFramePixels: vi.fn(
      (
        data: Uint8ClampedArray,
        w: number,
        h: number,
        params: FaceEnhanceParams,
        temporal: number,
        prev: Uint8ClampedArray | null
      ) => mod.processFramePixels(data, w, h, params, temporal, prev)
    ),
  };
});

describe("comparePixels — metrik perbedaan dua buffer RGBA", () => {
  /** Buffer 4×4 abu-abu (RGB 120/130/140, alpha 255). */
  function base(w = 4, h = 4): Uint8ClampedArray {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 120;
      d[i + 1] = 130;
      d[i + 2] = 140;
      d[i + 3] = 255;
    }
    return d;
  }

  it("buffer identik → PSNR ∞, semua diff 0", () => {
    const a = base();
    const b = new Uint8ClampedArray(a);
    const m = comparePixels(a, b, 4, 4)!;
    expect(m).not.toBeNull();
    expect(m.psnr).toBe(Infinity);
    expect(m.meanAbsDiff).toBe(0);
    expect(m.maxDiff).toBe(0);
    expect(m.pctChanged).toBe(0);
    expect(m.w).toBe(4);
    expect(m.h).toBe(4);
  });

  it("offset konstan +10 di RGB → PSNR 10·log10(255²/100) ≈ 28,1 dB, 100% berubah", () => {
    const a = base();
    const b = new Uint8ClampedArray(a);
    for (let i = 0; i < b.length; i += 4) {
      b[i] += 10;
      b[i + 1] += 10;
      b[i + 2] += 10;
    }
    const m = comparePixels(a, b, 4, 4)!;
    expect(m.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / 100), 5);
    expect(m.meanAbsDiff).toBeCloseTo(10, 5);
    expect(m.maxDiff).toBe(10);
    expect(m.pctChanged).toBe(100);
  });

  it("alpha tidak ikut dihitung; hanya sebagian piksel berubah → pctChanged proporsional", () => {
    const a = base(4, 4); // 16 piksel
    const b = new Uint8ClampedArray(a);
    // Ubah hanya 4 piksel (kanal merah +30) — alpha tetap beda tapi diabaikan.
    for (let p = 0; p < 4; p++) {
      const i = p * 4;
      b[i] += 30;
      b[i + 3] = 0; // alpha diubah agar teruji bahwa alpha diabaikan
    }
    const m = comparePixels(a, b, 4, 4)!;
    expect(m.pctChanged).toBeCloseTo(25, 5); // 4/16
    expect(m.meanAbsDiff).toBeCloseTo((30 * 4) / (3 * 16), 5);
    expect(m.maxDiff).toBe(30);
    expect(m.psnr).toBeLessThan(Infinity);
  });

  it("panjang buffer tidak cocok → null (PSNR tidak terdefinisi)", () => {
    const a = base(4, 4);
    const b = base(4, 5);
    expect(comparePixels(a, b, 4, 4)).toBeNull();
  });
});

describe("comparePipelines — Face Enhance vs Video Face Enhance pada frame sama", () => {
  /** Harness canvas minimal (pola faceEnhance.test.ts): getImageData mengembalikan
   *  data langkah keras (kiri terang 200,160,120 — kulit; kanan gelap 100,160,120)
   *  sehingga blur menghasilkan nilai berbeda dari aslinya. Komponen kulit kiri
   *  menyentuh tepi atas/bawah/kiri → ditolak detectFace → jalur tanpa wajah
   *  (koreksi global) yang deterministik. */
  function makeCanvasMock() {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        data[i] = x < 16 ? 200 : 100;
        data[i + 1] = 160;
        data[i + 2] = 120;
        data[i + 3] = 255;
      }
    }
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const getImageData = vi.fn(() => ({ data }));
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
    return { createElement, drawImage, putImageData, getImageData, canvases, data };
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
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SRC = {
    width: 32,
    height: 32,
    naturalWidth: 32,
    naturalHeight: 32,
  } as unknown as HTMLCanvasElement;

  it("parameter sama → hasil identik (PSNR ∞, diff 0)", () => {
    const P: FaceEnhanceParams = { ...NEUTRAL_PARAMS, fidelity: 40 };
    const res = comparePipelines(SRC, P, P, 32, 32);
    expect(res.face.canvas.width).toBe(32);
    expect(res.video.canvas.width).toBe(32);
    expect(res.metrics).not.toBeNull();
    expect(res.metrics!.psnr).toBe(Infinity);
    expect(res.metrics!.meanAbsDiff).toBe(0);
    expect(res.metrics!.maxDiff).toBe(0);
  });

  it("parameter berbeda → PSNR terbatas, diff > 0, wajah tidak terdeteksi pada data uji", () => {
    const faceParams: FaceEnhanceParams = {
      ...NEUTRAL_PARAMS,
      fidelity: 0,
      color: 100,
    };
    const videoParams: FaceEnhanceParams = {
      ...NEUTRAL_PARAMS,
      fidelity: 100,
      color: 0,
    };
    const res = comparePipelines(SRC, faceParams, videoParams, 32, 32);
    expect(res.face.faceDetected).toBe(false);
    expect(res.video.faceDetected).toBe(false);
    expect(res.metrics!.psnr).toBeLessThan(Infinity);
    expect(res.metrics!.maxDiff).toBeGreaterThan(0);
    expect(res.metrics!.pctChanged).toBeGreaterThan(0);
  });

  it("tiap pipeline membaca frame kerja sekali — deteksi berjalan murni di dalam processFramePixels (tanpa kanvas deteksi)", () => {
    const spy = vi.mocked(processFramePixels);
    spy.mockClear();
    const res = comparePipelines(SRC, NEUTRAL_PARAMS, NEUTRAL_PARAMS, 32, 32);
    // Satu getImageData per pipeline (frame kerja); deteksi tidak membuat
    // kanvas/read tambahan seperti detectFace(canvas) dulu.
    expect(h.getImageData.mock.calls.length).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[4]).toBe(0); // temporal = 0 → temporalBlend identitas
      expect(call[5]).toBeNull(); // prev = null
    }
    expect(res.metrics!.psnr).toBe(Infinity);
  });

  it("runFramePipeline ≡ processFramePixels: delegasi penuh (piksel frame persis, temporal 0, prev null), output mengalir dari sana", () => {
    const P: FaceEnhanceParams = { ...NEUTRAL_PARAMS, fidelity: 40 };
    const spy = vi.mocked(processFramePixels);
    spy.mockClear();
    const res = runFramePipeline(SRC, P, 32, 32);
    expect(spy).toHaveBeenCalledTimes(1);
    // Piksel yang dikirim = persis hasil getImageData kanvas kerja, bukan salinan.
    expect(spy).toHaveBeenCalledWith(h.data, 32, 32, P, 0, null);
    const inner = spy.mock.results[0]!.value;
    // data & faceDetected = persis kembalian processFramePixels (bukan
    // pipeline kedua/duplikat) — perbandingan tidak bisa melenceng diam-diam.
    expect(res.data).toBe(inner.out);
    expect(res.faceDetected).toBe(inner.faceDetected);
    expect(res.canvas.width).toBe(32);
  });
});
