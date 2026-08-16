import { describe, expect, it } from "vitest";
import {
  computePeaks,
  computeWaveStats,
  countFrames,
  DEFAULT_VIDEO_PARAMS,
  pickWorkingSize,
  processFramePixels,
  FRAME_SAMPLING,
  sampledBufferIndex,
  sampledFrames,
  samplingFactor,
  temporalBlend,
} from "./videoEnhance";
import { NEUTRAL_PARAMS } from "../face-enhance/faceEnhance";

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

describe("processFramePixels — pipeline per-frame (sumber tunggal worker/utama)", () => {
  const W = 40;
  const H = 40;
  /** Netral: w=100, semua efek 0 → enhancePixels identitas. */
  const NEUTRAL: Parameters<typeof processFramePixels>[3] = {
    ...NEUTRAL_PARAMS,
    fidelity: 100,
    smooth: 0,
    sharpen: 0,
    color: 0,
    background: false,
    restoreColor: false,
  };

  function gray(v: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    return d;
  }

  /** Wajah kulit di tengah (isSkinLike) di atas latar biru — box terdeteksi. */
  function faceImage(v: number): Uint8ClampedArray {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const inFace = x > 14 && x < 26 && y > 12 && y < 28;
        const c = inFace ? [230, 170, 130] : [90, 140, 220];
        d[i] = v === 0 ? c[0] : Math.min(255, c[0] + v);
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        d[i + 3] = 255;
      }
    }
    return d;
  }

  it("netral + tanpa wajah + prev null → identitas byte-ke-byte, faceDetected false", () => {
    const src = gray(120);
    const { out, faceDetected } = processFramePixels(src, W, H, NEUTRAL, 45, null);
    expect(out).toEqual(src);
    expect(faceDetected).toBe(false);
  });

  it("netral + temporal 0 + prev ada → identitas (koherensi temporal mati)", () => {
    const src = gray(120);
    const prev = gray(200);
    const { out } = processFramePixels(src, W, H, NEUTRAL, 0, prev);
    expect(out).toEqual(src);
  });

  it("netral + temporal 100 + prev → output di-blend ke arah prev (k=0.12 bg, tanpa kotak wajah)", () => {
    const src = gray(0);
    const prev = gray(200);
    const { out } = processFramePixels(src, W, H, NEUTRAL, 100, prev);
    // k=0.12 (latar): 0*(1-0.12)+200*0.12 = 24
    expect(out[(10 * W + 10) * 4]).toBe(Math.round(200 * 0.12));
    expect(out[(10 * W + 10) * 4 + 3]).toBe(255);
  });

  it("wajah terdeteksi → faceDetected true dan output berubah dari input", () => {
    const src = faceImage(0);
    const { out, faceDetected } = processFramePixels(
      src,
      W,
      H,
      { ...NEUTRAL, fidelity: 0, color: 100 },
      0,
      null
    );
    expect(faceDetected).toBe(true);
    // Pemulihan aktif → ada piksel yang berubah.
    let changed = 0;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] !== src[i] || out[i + 1] !== src[i + 1] || out[i + 2] !== src[i + 2]) {
        changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("ukuran sama dengan temporalBlend: prev dengan panjang berbeda diabaikan (identitas)", () => {
    const src = gray(100);
    const prev = new Uint8ClampedArray(10 * 10 * 4);
    const { out } = processFramePixels(src, W, H, NEUTRAL, 100, prev);
    expect(out).toEqual(src);
  });
});

describe("sampling frame — proses sebagian frame, durasi output tetap", () => {
  it("faktor: all=1, half=2, third=3", () => {
    expect(samplingFactor("all")).toBe(1);
    expect(samplingFactor("half")).toBe(2);
    expect(samplingFactor("third")).toBe(3);
  });

  it("sampledFrames: 60 slot → 60/30/20 frame diproses", () => {
    expect(sampledFrames(60, "all")).toBe(60);
    expect(sampledFrames(60, "half")).toBe(30);
    expect(sampledFrames(60, "third")).toBe(20);
  });

  it("video sangat pendek → minimal 1 frame diproses", () => {
    expect(sampledFrames(2, "third")).toBe(1);
    expect(sampledFrames(1, "half")).toBe(1);
  });

  it("sampledBufferIndex: tiap frame hasil ditahan `sf` slot berturut-turut", () => {
    // half: slot 0,1 → frame 0; slot 2,3 → frame 1; dst.
    expect([0, 1, 2, 3, 4, 5].map((i) => sampledBufferIndex(i, "half"))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
    // third: slot 0,1,2 → frame 0; 3,4,5 → frame 1.
    expect([0, 1, 2, 3, 4, 5].map((i) => sampledBufferIndex(i, "third"))).toEqual([
      0, 0, 0, 1, 1, 1,
    ]);
    // all: identitas.
    expect(sampledBufferIndex(3, "all")).toBe(3);
  });

  it("FRAME_SAMPLING memuat ketiga opsi; default params = all", () => {
    expect(FRAME_SAMPLING).toEqual(["all", "half", "third"]);
    expect(DEFAULT_VIDEO_PARAMS.frameSampling).toBe("all");
  });
});

describe("DEFAULT_VIDEO_PARAMS — default yang masuk akal", () => {
  it("melengkapi default face-enhance dengan opsi video", () => {
    expect(DEFAULT_VIDEO_PARAMS.fidelity).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_VIDEO_PARAMS.temporal).toBeGreaterThan(0);
    expect(DEFAULT_VIDEO_PARAMS.temporal).toBeLessThanOrEqual(100);
    expect([10, 15, 24, 30]).toContain(DEFAULT_VIDEO_PARAMS.fps);
    expect(["512", "720", "orig"]).toContain(DEFAULT_VIDEO_PARAMS.resMode);
    expect(FRAME_SAMPLING).toContain(DEFAULT_VIDEO_PARAMS.frameSampling);
  });
});

describe("computePeaks — data mini waveform dari AudioBuffer", () => {
  /** AudioBuffer palsu: kanal Float32Array langsung (kontrak getChannelData). */
  function fakeBuffer(
    channels: Float32Array[],
    sampleRate = 44100
  ): AudioBuffer {
    return {
      numberOfChannels: channels.length,
      length: channels[0]?.length ?? 0,
      sampleRate,
      getChannelData: (c: number) => channels[c] ?? new Float32Array(0),
    } as unknown as AudioBuffer;
  }

  it("buffer diam (nol) → semua puncak 0", () => {
    const b = fakeBuffer([new Float32Array(1000)]);
    const peaks = computePeaks(b, 10);
    expect(peaks.length).toBe(10);
    for (const p of peaks) expect(p).toBe(0);
  });

  it("amplitudo konstan 0.5 → tiap bucket ≈ 0.5", () => {
    const b = fakeBuffer([new Float32Array(1000).fill(0.5)]);
    const peaks = computePeaks(b, 8);
    for (const p of peaks) expect(p).toBeCloseTo(0.5, 5);
  });

  it("stereo mengambil puncak gabungan kedua kanal", () => {
    // Kanal kiri senyap, kanal kanan 0.8 → puncak 0.8.
    const b = fakeBuffer([new Float32Array(1000), new Float32Array(1000).fill(0.8)]);
    const peaks = computePeaks(b, 4);
    for (const p of peaks) expect(p).toBeCloseTo(0.8, 5);
  });

  it("puncak lokal tersimpan (bukan rata-rata) dan jumlah bucket sesuai", () => {
    // Satu ledakan di tengah buffer (0.9), sisanya senyap → hanya bucket
    // tengah yang tinggi; bucket lain mendekati 0.
    const d = new Float32Array(400);
    d[199] = 0.9;
    const b = fakeBuffer([d]);
    const peaks = computePeaks(b, 4);
    // Bucket 0: sampel 0..99 (senyap); bucket 2: sampel 200..299 (senyap).
    expect(peaks[0]).toBe(0);
    expect(peaks[2]).toBe(0);
    // Ledakan di sampel 199 → bucket 1 (100..199).
    expect(peaks[1]).toBeCloseTo(0.9, 5);
  });

  it("buffer kosong → nol; bucket ≤ 0 → array kosong", () => {
    const empty = fakeBuffer([new Float32Array(0)]);
    expect([...computePeaks(empty, 5)]).toEqual([0, 0, 0, 0, 0]);
    expect(computePeaks(fakeBuffer([new Float32Array(100)]), 0).length).toBe(0);
  });

  it("default 160 bucket", () => {
    const b = fakeBuffer([new Float32Array(1000).fill(0.3)]);
    expect(computePeaks(b).length).toBe(160);
  });
});

describe("computeWaveStats — statistik tooltip waveform", () => {
  it("puncak full-scale → 0 dB; durasi & kanal diteruskan", () => {
    const s = computeWaveStats(new Float32Array([0.5, 1.0, 0.7]), 2.04, 2);
    expect(s.peakDb).toBe(0);
    expect(s.duration).toBe(2.04);
    expect(s.channels).toBe(2);
  });

  it("puncak 0,5 → −6,02 dB (20·log10)", () => {
    const s = computeWaveStats(new Float32Array([0.5, 0.1]), 1, 1);
    expect(s.peakDb).toBeCloseTo(20 * Math.log10(0.5), 5);
  });

  it("senyap penuh → −Infinity", () => {
    expect(computeWaveStats(new Float32Array([0, 0, 0]), 1, 1).peakDb).toBe(
      -Infinity
    );
  });

  it("array kosong → −Infinity (tanpa NaN)", () => {
    expect(
      Number.isNaN(computeWaveStats(new Float32Array(0), 1, 1).peakDb)
    ).toBe(false);
    expect(computeWaveStats(new Float32Array(0), 1, 1).peakDb).toBe(-Infinity);
  });
});

