import { describe, expect, it } from "vitest";
import { buildImageHtml, fitImageDimensions, IMAGE_MAX_SIDE } from "./imageOps";
import { buildDocHtml } from "./docHtml";

describe("imageOps — penyisipan gambar di Word Editor", () => {
  it("menghitung skala gambar besar ke batas IMAGE_MAX_SIDE", () => {
    const dim = fitImageDimensions(2400, 1200);
    expect(dim.width).toBe(IMAGE_MAX_SIDE);
    expect(dim.height).toBe(Math.round(IMAGE_MAX_SIDE / 2));
  });

  it("mempertahankan gambar yang sudah lebih kecil dari batas", () => {
    const dim = fitImageDimensions(400, 300);
    expect(dim.width).toBe(400);
    expect(dim.height).toBe(300);
  });

  it("menolak dimensi tidak valid dengan 0x0", () => {
    expect(fitImageDimensions(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitImageDimensions(-10, 50)).toEqual({ width: 0, height: 0 });
    expect(fitImageDimensions(NaN, 50)).toEqual({ width: 0, height: 0 });
  });

  it("membangun markup gambar rata tengah secara default", () => {
    const html = buildImageHtml({ src: "data:image/png;base64,sample" });
    expect(html).toContain('class="doc-image-container"');
    expect(html).toContain("text-align: center;");
    expect(html).toContain('src="data:image/png;base64,sample"');
  });

  it("membangun markup gambar rata kiri dan kanan sesuai opsi", () => {
    const leftHtml = buildImageHtml({
      src: "data:image/png;base64,sample",
      alignment: "left",
    });
    expect(leftHtml).toContain("text-align: left;");

    const rightHtml = buildImageHtml({
      src: "data:image/png;base64,sample",
      alignment: "right",
    });
    expect(rightHtml).toContain("text-align: right;");
  });

  it("menyertakan teks caption jika disediakan", () => {
    const html = buildImageHtml({
      src: "data:image/jpeg;base64,sample",
      caption: "Foto Dokumentasi Kegiatan",
    });
    expect(html).toContain("Foto Dokumentasi Kegiatan");
  });

  it("kompatibel dengan buildDocHtml tanpa merusak sanitasi", () => {
    const imageHtml = buildImageHtml({
      src: "data:image/png;base64,sample",
      alt: "Logo Perusahaan",
    });
    const fullDoc = buildDocHtml("Dokumen Gambar", imageHtml);

    expect(fullDoc).toContain("<!doctype html>");
    expect(fullDoc).toContain("Logo Perusahaan");
    expect(fullDoc).toContain('class="doc-image-container"');
    expect(fullDoc).not.toContain("<script");
  });
});
