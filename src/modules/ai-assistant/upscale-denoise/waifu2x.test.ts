import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareFormats } from "./waifu2x";

/** Salinan logika PSNR compareFormats untuk ekspektasi independen. */
function psnr(src: Uint8ClampedArray, dec: Uint8ClampedArray): number | null {
  let mse = 0;
  const n = dec.length / 4;
  for (let i = 0; i < dec.length; i += 4) {
    const dr = src[i] - dec[i];
    const dg = src[i + 1] - dec[i + 1];
    const db = src[i + 2] - dec[i + 2];
    mse += dr * dr + dg * dg + db * db;
  }
  mse /= n * 3;
  return mse === 0 ? null : 10 * Math.log10((255 * 255) / mse);
}

// Gambar 2×1 (8 byte RGBA). PNG diasumsikan lossless (decode = sumber);
// WebP/JPG sedikit/kbanyak berbeda untuk menghasilkan PSNR terukur.
const SRC = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
const DEC_PNG = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
const DEC_WEBP = new Uint8ClampedArray([12, 20, 30, 255, 40, 52, 60, 255]);
const DEC_JPG = new Uint8ClampedArray([10, 20, 30, 255, 100, 50, 60, 255]);

interface Harness {
  sourceCanvas: HTMLCanvasElement;
  getImageData: ReturnType<typeof vi.fn>;
  toBlob: ReturnType<typeof vi.fn>;
  createImageBitmap: ReturnType<typeof vi.fn>;
  createElement: ReturnType<typeof vi.fn>;
  decodeCanvases: Array<{ width: number; height: number }>;
  drawImage: ReturnType<typeof vi.fn>;
}

/** Bangun mock lengkap lingkungan canvas: toBlob per format, decode per format. */
function makeHarness(options: {
  /** Bila diisi: format ini membuat createImageBitmap menolak (jalur error). */
  failFormat?: string;
  bmpDims?: { width: number; height: number };
} = {}): Harness {
  const { failFormat, bmpDims = { width: 2, height: 1 } } = options;
  const decodedByFmt: Record<string, Uint8ClampedArray> = {
    png: DEC_PNG,
    webp: DEC_WEBP,
    jpg: DEC_JPG,
  };
  let currentFmt = "";

  const getImageData = vi.fn(() => ({ data: SRC }));
  const toBlob = vi.fn((cb: (b: Blob) => void, type: string, q: number) => {
    // canvasToBlob memakai image/jpeg untuk jpg — normalisasi kembali ke jpg
    // agar lookup data decode & guard failFormat konsisten.
    currentFmt = type === "image/jpeg" ? "jpg" : type.replace("image/", "");
    cb(new Blob([`${currentFmt}:${q}`]));
  });
  const sourceCanvas = {
    width: 2,
    height: 1,
    getContext: () => ({ getImageData }),
    toBlob,
  } as unknown as HTMLCanvasElement;

  const createImageBitmap = vi.fn(async (_blob: Blob) => {
    if (currentFmt === failFormat) throw new Error("decode gagal");
    return { width: bmpDims.width, height: bmpDims.height, close: vi.fn() };
  });

  const decodeCanvases: Array<{ width: number; height: number }> = [];
  const drawImage = vi.fn();
  const createElement = vi.fn(() => {
    const c: { width: number; height: number; getContext: () => unknown } = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage,
        getImageData: () => ({ data: decodedByFmt[currentFmt] }),
      }),
    };
    decodeCanvases.push(c);
    return c;
  }) as unknown as ReturnType<typeof vi.fn>;

  return {
    sourceCanvas,
    getImageData,
    toBlob,
    createImageBitmap,
    createElement,
    decodeCanvases,
    drawImage,
  };
}

describe("compareFormats", () => {
  beforeEach(() => {
    vi.stubGlobal("createImageBitmap", undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("menghasilkan 3 entry berurutan PNG/WebP/JPG dengan ukuran dari blob & PSNR benar", async () => {
    const h = makeHarness();
    vi.stubGlobal("createImageBitmap", h.createImageBitmap);
    vi.stubGlobal("document", { createElement: h.createElement });

    const out = await compareFormats(h.sourceCanvas, 92);

    expect(out.map((e) => e.format)).toEqual(["png", "webp", "jpg"]);
    // Ukuran mengalir dari blob sungguhan (type:kualitas).
    expect(out[0].size).toBe(new Blob(["png:0.92"]).size);
    expect(out[1].size).toBe(new Blob(["webp:0.92"]).size);
    expect(out[2].size).toBe(new Blob(["jpg:0.92"]).size);
    // PNG lossless (decode = sumber, mse 0) → PSNR tak terhingga (∞ dB);
    // WebP/JPG lossy → PSNR terukur.
    expect(out[0].psnrDb).toBe(Infinity);
    expect(out[1].psnrDb).toBeCloseTo(psnr(SRC, DEC_WEBP)!, 2);
    expect(out[2].psnrDb).toBeCloseTo(psnr(SRC, DEC_JPG)!, 2);
  });

  it("meneruskan kualitas sebagai fraksi (quality/100) ke toBlob tiap format", async () => {
    const h = makeHarness();
    vi.stubGlobal("createImageBitmap", h.createImageBitmap);
    vi.stubGlobal("document", { createElement: h.createElement });

    await compareFormats(h.sourceCanvas, 60);

    expect(h.toBlob).toHaveBeenCalledTimes(3);
    expect(h.toBlob.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      ["image/png", 0.6],
      ["image/webp", 0.6],
      ["image/jpeg", 0.6],
    ]);
  });

  it("membaca piksel sumber sekali dengan dimensi kanvas dan tidak mengubah kanvas sumber", async () => {
    const h = makeHarness();
    vi.stubGlobal("createImageBitmap", h.createImageBitmap);
    vi.stubGlobal("document", { createElement: h.createElement });

    await compareFormats(h.sourceCanvas, 90);

    expect(h.getImageData).toHaveBeenCalledTimes(1);
    expect(h.getImageData).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(h.sourceCanvas.width).toBe(2);
    expect(h.sourceCanvas.height).toBe(1);
  });

  it("kanvas decode mengikuti dimensi hasil decode (bmp), bukan asumsi sumber", async () => {
    const h = makeHarness({ bmpDims: { width: 4, height: 2 } });
    // decode data 8 byte cocok untuk kanvas 4×2? PSNR membaca d.length — biarkan
    // data apa adanya; yang diuji di sini hanya penyalinan dimensi bmp.
    vi.stubGlobal("createImageBitmap", h.createImageBitmap);
    vi.stubGlobal("document", { createElement: h.createElement });

    await compareFormats(h.sourceCanvas, 90);

    expect(h.decodeCanvases).toHaveLength(3);
    for (const c of h.decodeCanvases) {
      expect(c.width).toBe(4);
      expect(c.height).toBe(2);
    }
  });

  it("format yang gagal di-decode tetap ada sebagai entry size 0 / PSNR null, loop lanjut", async () => {
    const h = makeHarness({ failFormat: "webp" });
    vi.stubGlobal("createImageBitmap", h.createImageBitmap);
    vi.stubGlobal("document", { createElement: h.createElement });

    const out = await compareFormats(h.sourceCanvas, 90);

    expect(out).toHaveLength(3);
    // Gagal decode → null (bukan Infinity): render tabel tetap "—",
    // sedangkan rekonstruksi identik (mse 0) → Infinity ("∞ dB").
    expect(out[1]).toEqual({ format: "webp", size: 0, psnrDb: null });
    expect(out[0].psnrDb).toBe(Infinity); // png tetap dihitung, lossless
    // PNG & JPG tetap dihitung walau webp gagal.
    expect(out[0].size).toBeGreaterThan(0);
    expect(out[2].size).toBeGreaterThan(0);
    expect(out[2].psnrDb).toBeCloseTo(psnr(SRC, DEC_JPG)!, 2);
  });
});
