import { describe, expect, it } from "vitest";
import { coverFit, frameAt, totalDuration } from "./slideshow";

describe("coverFit — tata letak gambar menutupi kanvas penuh", () => {
  it("rasio sama → mengisi penuh tanpa offset", () => {
    expect(coverFit(200, 100, 400, 200)).toEqual({
      dx: 0,
      dy: 0,
      dw: 400,
      dh: 200,
    });
  });

  it("gambar lebih lebar → di-crop kiri/kanan (tinggi penuh)", () => {
    // 400×100 di kanvas 400×200: scale = max(1, 2) = 2 → dw 800, dh 200.
    const r = coverFit(400, 100, 400, 200);
    expect(r.dw).toBe(800);
    expect(r.dh).toBe(200);
    expect(r.dx).toBe((400 - 800) / 2);
    expect(r.dy).toBe(0);
  });

  it("gambar lebih tinggi → di-crop atas/bawah (lebar penuh)", () => {
    const r = coverFit(100, 400, 400, 200);
    expect(r.dw).toBe(400);
    expect(r.dh).toBe(1600);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe((200 - 1600) / 2);
  });
});

describe("totalDuration — slide × durasi per slide", () => {
  it("4 slide @ 3 dtk → 12 dtk", () => {
    expect(totalDuration(4, 3)).toBe(12);
  });

  it("tanpa slide / durasi 0 → 0", () => {
    expect(totalDuration(0, 3)).toBe(0);
    expect(totalDuration(3, 0)).toBe(0);
  });
});

describe("frameAt — timing fade antar slide", () => {
  const S = 3; // slideDur
  const F = 1; // fadeDur

  it("awal slide pertama: index 0, belum fade", () => {
    expect(frameAt(0, 4, S, F)).toEqual({ index: 0, next: 1, fade: 0 });
  });

  it("di dalam slide (t = 1,5): belum fade", () => {
    expect(frameAt(1.5, 4, S, F)).toEqual({ index: 0, next: 1, fade: 0 });
  });

  it("window fade (t = 2,5 dari 3): fade 0,5 menuju slide 1", () => {
    const f = frameAt(2.5, 4, S, F);
    expect(f.index).toBe(0);
    expect(f.next).toBe(1);
    expect(f.fade).toBeCloseTo(0.5, 5);
  });

  it("tepat di peralihan → slide berikutnya, fade reset", () => {
    expect(frameAt(3, 4, S, F)).toEqual({ index: 1, next: 2, fade: 0 });
  });

  it("slide terakhir tidak fade keluar", () => {
    // t = 11,9 (slide 3 dari 4, di dalam durasinya) → tanpa next.
    expect(frameAt(11.9, 4, S, F)).toEqual({ index: 3, next: null, fade: 0 });
  });

  it("t melampaui durasi → tetap di slide terakhir", () => {
    expect(frameAt(99, 4, S, F).index).toBe(3);
  });

  it("fadeDur lebih dari setengah slide → dibatasi setengah", () => {
    // fadeDur 2 > 3/2 → effFade 1.5; fadeStart = 1.5; di t=1,75: fade = 0.25/1.5.
    const f = frameAt(1.75, 4, S, 2);
    expect(f.index).toBe(0);
    expect(f.fade).toBeCloseTo(0.25 / 1.5, 5);
  });

  it("tanpa slide → index 0 tanpa next", () => {
    expect(frameAt(0, 0, S, F)).toEqual({ index: 0, next: null, fade: 0 });
  });
});
