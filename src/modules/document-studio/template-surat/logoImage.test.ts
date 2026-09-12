import { describe, expect, it } from "vitest";
import { fitWithin, LOGO_MAX_SIDE } from "./logoImage";

describe("fitWithin — dimensi logo yang disimpan", () => {
  it("gambar yang sudah kecil tidak diperbesar", () => {
    expect(fitWithin(200, 100)).toEqual({ width: 200, height: 100 });
  });

  it("landscape: sisi terpanjang dipetakan ke batas, rasio dipertahankan", () => {
    expect(fitWithin(2000, 1000)).toEqual({ width: 512, height: 256 });
  });

  it("portrait: sisi terpanjang dipetakan ke batas, rasio dipertahankan", () => {
    expect(fitWithin(1000, 4000)).toEqual({ width: 128, height: 512 });
  });

  it("persis di batas tidak diubah", () => {
    expect(fitWithin(LOGO_MAX_SIDE, 100)).toEqual({ width: 512, height: 100 });
  });

  it("satu piksel di atas batas ikut diskalakan", () => {
    expect(fitWithin(LOGO_MAX_SIDE + 1, LOGO_MAX_SIDE)).toEqual({
      width: 512,
      height: 511,
    });
  });

  it("rasio ekstrem tetap menghasilkan minimal 1 px", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 512, height: 1 });
    expect(fitWithin(1, 10000)).toEqual({ width: 1, height: 512 });
  });

  it("dimensi tak valid -> 0x0 (pemanggil menolak berkasnya)", () => {
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 10)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(10, -5)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Number.NaN, 10)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(Infinity, 10)).toEqual({ width: 0, height: 0 });
  });

  it("maxSide tak valid -> 0x0", () => {
    expect(fitWithin(100, 100, 0)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(100, 100, Number.NaN)).toEqual({ width: 0, height: 0 });
  });
});
