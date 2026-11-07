import { describe, it, expect } from "vitest";
import { applyColorFilters } from "./adjustImageParams";

describe("adjustImageParams (Pixel manipulation)", () => {
  it("tidak mengubah piksel jika parameter filter default (semua 0)", () => {
    const raw = new Uint8ClampedArray([100, 150, 200, 255]);
    const res = applyColorFilters(raw, {});

    expect(res[0]).toBe(100);
    expect(res[1]).toBe(150);
    expect(res[2]).toBe(200);
    expect(res[3]).toBe(255);
  });

  it("menaikkan dan menurunkan kecerahan (brightness) dengan batasan aman clamp 0-255", () => {
    // Naikkan brightness +20% (sekitar +51 level RGB)
    const bright = new Uint8ClampedArray([100, 240, 50, 255]);
    applyColorFilters(bright, { brightness: 20 });
    expect(bright[0]).toBe(151);
    expect(bright[1]).toBe(255); // clamped at 255
    expect(bright[2]).toBe(101);

    // Turunkan brightness -50%
    const dark = new Uint8ClampedArray([100, 200, 50, 255]);
    applyColorFilters(dark, { brightness: -50 });
    expect(dark[0]).toBeLessThan(100);
    expect(dark[2]).toBe(0); // clamped at 0
  });

  it("menerapkan grayscale 100% sehingga kanal R, G, B identik (Luminance Rec.709)", () => {
    const colorPixel = new Uint8ClampedArray([200, 100, 50, 255]);
    applyColorFilters(colorPixel, { grayscale: 100 });

    // R, G, B harus bernilai sama (monokrom)
    expect(colorPixel[0]).toBe(colorPixel[1]);
    expect(colorPixel[1]).toBe(colorPixel[2]);
    // 0.2126*200 + 0.7152*100 + 0.0722*50 = 42.52 + 71.52 + 3.61 = 117.65 -> 118
    expect(colorPixel[0]).toBe(118);
  });

  it("menerapkan filter temperatur warna (warm menambah merah, cool menambah biru)", () => {
    // Warm filter (+50)
    const warmPixel = new Uint8ClampedArray([100, 100, 100, 255]);
    applyColorFilters(warmPixel, { temperature: 50 });
    expect(warmPixel[0]).toBeGreaterThan(100); // R naik
    expect(warmPixel[2]).toBeLessThan(100);    // B turun

    // Cool filter (-50)
    const coolPixel = new Uint8ClampedArray([100, 100, 100, 255]);
    applyColorFilters(coolPixel, { temperature: -50 });
    expect(coolPixel[0]).toBeLessThan(100);    // R turun
    expect(coolPixel[2]).toBeGreaterThan(100); // B naik
  });

  it("menaikkan kontras pada piksel terang dan menurunkan pada piksel gelap", () => {
    const pixels = new Uint8ClampedArray([
      200, 200, 200, 255, // terang (> 128)
      50, 50, 50, 255,     // gelap (< 128)
    ]);

    applyColorFilters(pixels, { contrast: 30 });
    expect(pixels[0]).toBeGreaterThan(200); // makin terang
    expect(pixels[4]).toBeLessThan(50);     // makin gelap
  });
});
