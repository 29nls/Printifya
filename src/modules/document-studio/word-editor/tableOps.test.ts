import { describe, expect, it } from "vitest";
import { appendColToTable, appendRowToTable, buildTableHtml } from "./tableOps";
import { buildDocHtml } from "./docHtml";

describe("tableOps — pembentukan tabel Word Editor", () => {
  it("membangun tabel default 3x3 dengan header", () => {
    const html = buildTableHtml({ rows: 3, cols: 3, hasHeader: true });

    expect(html).toContain('<table class="doc-table">');
    expect(html).toContain("<th>Kolom 1</th>");
    expect(html).toContain("<th>Kolom 2</th>");
    expect(html).toContain("<th>Kolom 3</th>");

    // Total 3 <tr>
    const trMatches = html.match(/<tr/g);
    expect(trMatches?.length).toBe(3);

    // Total 3 <th> dan 6 <td>
    const thMatches = html.match(/<th/g);
    const tdMatches = html.match(/<td/g);
    expect(thMatches?.length).toBe(3);
    expect(tdMatches?.length).toBe(6);
  });

  it("membangun tabel tanpa header", () => {
    const html = buildTableHtml({ rows: 2, cols: 2, hasHeader: false });
    expect(html).not.toContain("<th");
    const tdMatches = html.match(/<td/g);
    expect(tdMatches?.length).toBe(4);
  });

  it("membatasi clamp baris dan kolom yang tidak wajar", () => {
    const html = buildTableHtml({ rows: 999, cols: 999, hasHeader: true });
    const trMatches = html.match(/<tr/g);
    expect(trMatches?.length).toBe(50); // Max 50 baris

    const thMatches = html.match(/<th/g);
    expect(thMatches?.length).toBe(20); // Max 20 kolom
  });

  it("menambahkan baris baru ke tabel", () => {
    const initial = buildTableHtml({ rows: 2, cols: 2, hasHeader: true });
    const updated = appendRowToTable(initial);
    const trMatches = updated.match(/<tr/g);
    expect(trMatches?.length).toBe(3);
  });

  it("menambahkan kolom baru ke tabel", () => {
    const initial = buildTableHtml({ rows: 2, cols: 2, hasHeader: true });
    const updated = appendColToTable(initial);
    const thMatches = updated.match(/<th/g);
    const tdMatches = updated.match(/<td/g);
    expect(thMatches?.length).toBe(3);
    expect(tdMatches?.length).toBe(3);
  });

  it("kompatibel dengan buildDocHtml tanpa merusak sanitasi", () => {
    const tableHtml = buildTableHtml({ rows: 2, cols: 2, hasHeader: true });
    const fullDoc = buildDocHtml("Judul Tes", tableHtml);

    expect(fullDoc).toContain('<table class="doc-table">');
    expect(fullDoc).toContain("<!doctype html>");
    expect(fullDoc).toContain("Judul Tes");
    expect(fullDoc).not.toContain("<script");
  });
});
