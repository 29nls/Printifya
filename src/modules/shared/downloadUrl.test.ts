import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blobToDataUrl, shouldRevokeBlobUrl } from "./downloadUrl";

// --- Fake FileReader (vitest berjalan di Node tanpa DOM) ---
let failRead = false;
const readSpy = vi.fn();
class FakeFileReader {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: string | null = null;
  error: Error | null = null;
  readAsDataURL: (blob: Blob) => void = (blob) => {
    readSpy(blob);
    if (failRead) {
      this.error = new Error("read error");
      queueMicrotask(() => this.onerror?.());
    } else {
      this.result = "data:application/octet-stream;base64,AAAA";
      queueMicrotask(() => this.onload?.());
    }
  };
}

describe("shouldRevokeBlobUrl — kebijakan revoke terpusat", () => {
  it("URL blob: default → revoke", () => {
    expect(shouldRevokeBlobUrl("blob:http://localhost/abc-123")).toBe(true);
  });

  it("URL data: default → tidak di-revoke (inline, tanpa sumber daya)", () => {
    expect(shouldRevokeBlobUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      false
    );
  });

  it("skema lain (http/https) default → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("https://example.com/foto.png")).toBe(false);
  });

  it("opts.revoke memaksa: blob: dengan revoke:false → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("blob:http://localhost/x", { revoke: false })).toBe(
      false
    );
  });

  it("opts.revoke memaksa: data: dengan revoke:true → di-revoke", () => {
    expect(shouldRevokeBlobUrl("data:image/png;base64,AA==", { revoke: true })).toBe(
      true
    );
  });

  it("string kosong → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("")).toBe(false);
  });
});

describe("blobToDataUrl — Blob → data URL via FileReader", () => {
  beforeEach(() => {
    failRead = false;
    readSpy.mockClear();
    vi.stubGlobal("FileReader", FakeFileReader);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolve data URL dari blob (readAsDataURL dipanggil dengan blob)", async () => {
    const blob = new Blob(["x"], { type: "text/plain" });
    const url = await blobToDataUrl(blob);
    expect(url).toBe("data:application/octet-stream;base64,AAAA");
    expect(readSpy).toHaveBeenCalledWith(blob);
  });

  it("reject saat FileReader error (fr.error diteruskan)", async () => {
    failRead = true;
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toThrow("read error");
  });

  it("reject dengan pesan default bila fr.error kosong", async () => {
    // onerror dipicu tanpa error terpasang → fallback pesan default
    class NoErrReader extends FakeFileReader {
      readAsDataURL: (blob: Blob) => void = () => {
        queueMicrotask(() => this.onerror?.());
      };
    }
    vi.stubGlobal("FileReader", NoErrReader);
    await expect(blobToDataUrl(new Blob(["x"]))).rejects.toThrow(
      "Gagal mengonversi hasil ke data URL."
    );
  });
});
