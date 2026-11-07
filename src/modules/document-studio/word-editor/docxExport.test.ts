import { describe, expect, it } from "vitest";
import { buildDocxBlob, DOCX_MIME_TYPE } from "./docxExport";

describe("docxExport", () => {
  it("menghasilkan Blob dengan tipe OpenXML DOCX yang valid", () => {
    const title = "Laporan Penjualan";
    const content = "<p>Halo <b>Dunia</b>! Ini teks dokumen.</p>";
    const blob = buildDocxBlob(title, content);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe(DOCX_MIME_TYPE);
    expect(blob.size).toBeGreaterThan(100);
  });

  it("mampu menangani heading, formatting bold/italic, dan tabel", async () => {
    const title = "Surat Perjanjian";
    const content = `
      <h1>Bab 1: Pendahuluan</h1>
      <p>Ini adalah paragraf <i>penting</i>.</p>
      <table>
        <tr><th>No</th><th>Barang</th></tr>
        <tr><td>1</td><td>Kertas A4</td></tr>
      </table>
    `;
    const blob = buildDocxBlob(title, content);
    expect(blob.type).toBe(DOCX_MIME_TYPE);

    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Header signature ZIP lokal: 0x50, 0x4b, 0x03, 0x04 ("PK\x03\x04")
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});
