import { describe, it, expect, vi } from "vitest";
import {
  calculateWatermarkCoordinates,
  stampWatermarkOnCanvas,
  type WatermarkStampOptions,
} from "./watermarkStamping";

describe("Watermark & Metadata Stamping", () => {
  it("menghitung koordinat sudut kanan bawah (bottom-right) dengan padding yang tepat", () => {
    const coords = calculateWatermarkCoordinates(1200, 1800, "Studio Foto ABC", {
      position: "bottom-right",
      padding: 20,
    });

    expect(coords.x).toBe(1180);
    expect(coords.y).toBe(1780);
    expect(coords.renderedText).toBe("Studio Foto ABC");
  });

  it("menyematkan metadata timestamp ke dalam string teks watermark", () => {
    const coords = calculateWatermarkCoordinates(1200, 1800, "Printifya Studio", {
      position: "bottom-left",
      padding: 15,
      timestamp: "2026-11-07",
    });

    expect(coords.x).toBe(15);
    expect(coords.y).toBe(1785);
    expect(coords.renderedText).toBe("Printifya Studio • 2026-11-07");
  });

  it("menghitung koordinat tengah bawah untuk posisi margin-footer", () => {
    const coords = calculateWatermarkCoordinates(1000, 1500, "Hak Cipta Studio", {
      position: "margin-footer",
      padding: 10,
    });

    expect(coords.x).toBe(500); // center (width / 2)
    expect(coords.y).toBe(1490);
  });

  it("merender watermark ke canvas context dengan konfigurasi opacity dan font", () => {
    const mockCtx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      font: "",
      fillStyle: "",
      textAlign: "left" as const,
      textBaseline: "top" as const,
      globalAlpha: 1.0,
    };

    const options: WatermarkStampOptions = {
      text: "Printifya Studio Official",
      opacity: 0.5,
      fontSize: 14,
      fontColor: "#666666",
      position: "bottom-right",
      padding: 24,
    };

    const res = stampWatermarkOnCanvas(mockCtx, 800, 1200, options);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.globalAlpha).toBe(0.5);
    expect(mockCtx.font).toBe("14px sans-serif");
    expect(mockCtx.fillStyle).toBe("#666666");
    expect(mockCtx.textAlign).toBe("right");
    expect(mockCtx.textBaseline).toBe("bottom");
    expect(mockCtx.fillText).toHaveBeenCalledWith("Printifya Studio Official", 776, 1176);
    expect(res.x).toBe(776);
    expect(res.y).toBe(1176);
  });
});
