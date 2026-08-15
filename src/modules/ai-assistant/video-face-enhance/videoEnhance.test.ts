import { describe, expect, it } from "vitest";
import {
  countFrames,
  DEFAULT_VIDEO_PARAMS,
  pickWorkingSize,
  temporalBlend,
} from "./videoEnhance";

describe("pickWorkingSize — resolusi kerja video", () => {
  it("orig mempertahankan ukuran asli (dimensi genap minimal 2)", () => {
    expect(pickWorkingSize(1280, 720, "orig")).toEqual({ w: 1280, h: 720 });
    expect(pickWorkingSize(1, 1, "orig")).toEqual({ w: 2, h: 2 });
  });

  it("512 membatasi sisi terpanjang ke 512 dengan rasio aspek & dimensi genap", () => {
    // 1280×720 → skala 512/1280 = 0.4 → 512×288
    expect(pickWorkingSize(1280, 720, "512")).toEqual({ w: 512, h: 288 });
    // 720×1280 (potret) → 288×512
    expect(pickWorkingSize(720, 1280, "512")).toEqual({ w: 288, h: 512 });
    // sudah ≤ 512 → tidak diperbesar (dimensi digenapkan)
    expect(pickWorkingSize(480, 270, "512")).toEqual({ w: 480, h: 270 });
  });

  it("720 membatasi sisi terpanjang ke 720", () => {
    expect(pickWorkingSize(1920, 1080, "720")).toEqual({ w: 720, h: 406 });
  });

  it("ukuran ganjil dibulatkan ke genap (codec video)", () => {
    const { w, h } = pickWorkingSize(1001, 751, "720");
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
  });
});

describe("countFrames — jumlah frame dari durasi & fps", () => {
  it("durasi × fps dibulatkan", () => {
    expect(countFrames(10, 15)).toBe(150);
    expect(countFrames(10.4, 15)).toBe(156);
  });

  it("minimal 1 (video sangat pendek tetap diproses)", () => {
    expect(countFrames(0.01, 15)).toBe(1);
  });

  it("0 untuk durasi/fps tidak valid", () => {
    expect(countFrames(0, 15)).toBe(0);
    expect(countFrames(NaN, 15)).toBe(0);
    expect(countFrames(10, 0)).toBe(0);
  });
});

describe("temporalBlend — koherensi temporal (PGTFormer)", () => {
  const W = 10;
  const H = 10;
  const BOX = { x0: 2, y0: 2, x1: 6, y1: 6 };
  const FACE_K = (0.55 * 100) / 100; // tc=100 → 0.55 di kotak wajah
  const BG_K = (0.12 * 100) / 100; // tc=100 → 0.12 di luar

  function frame(v: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    return d;
  }

  it("tc=0 → identitas (out tidak berubah)", () => {
    const out = frame(50);
    const prev = frame(200);
    temporalBlend(out, prev, W, H, BOX, 0);
    expect([...out]).toEqual([...frame(50)]);
  });

  it("tanpa prev → identitas (frame pertama)", () => {
    const out = frame(50);
    temporalBlend(out, null, W, H, BOX, 100);
    expect([...out]).toEqual([...frame(50)]);
  });

  it("tc=100: di dalam kotak wajah blended kuat (k=0.55), di luar lemah (k=0.12)", () => {
    const out = frame(0);
    const prev = frame(200);
    temporalBlend(out, prev, W, H, BOX, 100);
    const at = (x: number, y: number) => out[(y * W + x) * 4];
    // Di dalam kotak: 0*(1-0.55)+200*0.55 = 110
    expect(at(3, 3)).toBe(Math.round(200 * FACE_K));
    // Di luar kotak: 0*(1-0.12)+200*0.12 = 24
    expect(at(0, 0)).toBe(Math.round(200 * BG_K));
    expect(at(9, 9)).toBe(Math.round(200 * BG_K));
    // Kotak wajah lebih dekat ke prev daripada latar (stabilisasi wajah).
    expect(at(3, 3)).toBeGreaterThan(at(0, 0));
  });

  it("tc=50: setengah kekuatan (face 0.275, bg 0.06)", () => {
    const out = frame(0);
    const prev = frame(200);
    temporalBlend(out, prev, W, H, BOX, 50);
    const at = (x: number, y: number) => out[(y * W + x) * 4];
    expect(at(3, 3)).toBe(Math.round(200 * (0.55 * 0.5)));
    expect(at(0, 0)).toBe(Math.round(200 * (0.12 * 0.5)));
  });

  it("tanpa kotak wajah: blend lembut seluruh frame (k=0.12)", () => {
    const out = frame(0);
    const prev = frame(200);
    temporalBlend(out, prev, W, H, null, 100);
    expect(out[(5 * W + 5) * 4]).toBe(Math.round(200 * BG_K));
  });

  it("nilai ter-clamp ke 0..255", () => {
    const out = frame(10);
    const prev = frame(255);
    temporalBlend(out, prev, W, H, BOX, 100);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(255);
    }
  });

  it("ukuran tidak sama → identitas (prev dari video lain)", () => {
    const out = frame(50);
    const prev = new Uint8ClampedArray(4 * 4 * 4);
    temporalBlend(out, prev, W, H, BOX, 100);
    expect([...out]).toEqual([...frame(50)]);
  });
});

describe("DEFAULT_VIDEO_PARAMS — default yang masuk akal", () => {
  it("melengkapi default face-enhance dengan opsi video", () => {
    expect(DEFAULT_VIDEO_PARAMS.fidelity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_VIDEO_PARAMS.temporal).toBeGreaterThan(0);
    expect(DEFAULT_VIDEO_PARAMS.temporal).toBeLessThanOrEqual(100);
    expect([10, 15, 24, 30]).toContain(DEFAULT_VIDEO_PARAMS.fps);
    expect(["512", "720", "orig"]).toContain(DEFAULT_VIDEO_PARAMS.resMode);
  });
});
