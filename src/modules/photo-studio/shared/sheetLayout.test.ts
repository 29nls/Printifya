import { describe, expect, it } from "vitest";
import {
  computeSheetLayout,
  scaleSheetLayout,
  sheetCellAtPoint,
  sheetCellRect,
  sheetLabelBarMm,
} from "./sheetLayout";
import type { PasFotoSize } from "./pasFotoSize";
import type { PaperSize } from "./paperSize";

// Pas foto 3×4 cm + A4 potret + margin 0.5 cm — grid 6×7 = 42 sel.
const SIZE: PasFotoSize = {
  id: "3x4",
  title: "Pas Foto 3x4",
  label: "3 × 4 cm",
  description: "",
  icon: "🪪",
  widthPx: 354,
  heightPx: 472,
  widthMm: 30,
  heightMm: 40,
  fileName: "pas-foto-3x4",
};
const A4: PaperSize = { id: "a4", name: "A4", widthMm: 210, heightMm: 297 };
const layout = computeSheetLayout(SIZE, 6, 7, 0.5, A4, "portrait");

describe("sheetCellRect — posisi sel absolut (mm)", () => {
  it("sel pertama di pojok kiri-atas grid (margin sentris)", () => {
    // grid 180×280 mm di A4 → marginX = (210−180)/2 = 15, marginY = (297−280)/2 = 8.5
    const r = sheetCellRect(0, 6, 30, 40, layout);
    expect(r).toEqual({ x: 15, y: 8.5, w: 30, h: 40 });
  });

  it("posisi baris-kolom benar: kiri-ke-kanan, atas-ke-bawah", () => {
    const r1 = sheetCellRect(1, 6, 30, 40, layout);
    expect(r1.x).toBeCloseTo(45, 6); // 15 + 1·30
    expect(r1.y).toBe(8.5);
    const r6 = sheetCellRect(6, 6, 30, 40, layout); // baris kedua
    expect(r6.x).toBe(15);
    expect(r6.y).toBeCloseTo(48.5, 6); // 8.5 + 40
  });

  it("sel terakhir memakai kolom & baris maksimal", () => {
    const r = sheetCellRect(41, 6, 30, 40, layout); // baris 6, kolom 5
    expect(r.x).toBeCloseTo(165, 6); // 15 + 5·30
    expect(r.y).toBeCloseTo(248.5, 6); // 8.5 + 6·40
  });
});

describe("scaleSheetLayout + sheetCellRect — layout px (pratinjau)", () => {
  it("menskalakan semua dimensi; count tidak berubah", () => {
    const px = scaleSheetLayout(layout, 1.5);
    expect(px.gridW).toBeCloseTo(270, 6);
    expect(px.gridH).toBeCloseTo(420, 6);
    expect(px.marginX).toBeCloseTo(22.5, 6);
    expect(px.marginY).toBeCloseTo(12.75, 6);
    expect(px.count).toBe(42);
  });

  it("sheetCellRect memakai layout px untuk posisi & ukuran px", () => {
    const px = scaleSheetLayout(layout, 2);
    const r = sheetCellRect(7, 6, 60, 80, px);
    expect(r.x).toBe(30 + 60); // marginX(15·2) + 1·60
    expect(r.y).toBe(17 + 80); // marginY(8.5·2) + 1·80
    expect(r.w).toBe(60);
    expect(r.h).toBe(80);
  });
});

describe("sheetCellAtPoint — titik absolut ke indeks sel (logika drag)", () => {
  it("memetakan titik dalam sel ke indeks yang benar", () => {
    // titik di tengah sel indeks 7 (baris 1, kolom 1) dalam mm
    const x = 15 + 30 + 15; // marginX + 1·30 + setengah lebar
    const y = 8.5 + 40 + 20;
    expect(sheetCellAtPoint(x, y, 6, 7, 30, 40, layout)).toBe(7);
  });

  it("titik di area margin luar grid → -1", () => {
    expect(sheetCellAtPoint(5, 5, 6, 7, 30, 40, layout)).toBe(-1);
    expect(sheetCellAtPoint(300, 200, 6, 7, 30, 40, layout)).toBe(-1);
  });

  it("konsisten dengan sheetCellRect (invers yang tepat)", () => {
    for (const i of [0, 5, 6, 41]) {
      const r = sheetCellRect(i, 6, 30, 40, layout);
      const px = layout;
      expect(sheetCellAtPoint(r.x + 1, r.y + 1, 6, 7, 30, 40, px)).toBe(i);
    }
  });
});

describe("sheetLabelBarMm — area label di dasar sel", () => {
  it("tinggi batang dari ukuran font (pt) + padding tetap, menempel di dasar sel", () => {
    const bar = sheetLabelBarMm(40, 7);
    expect(bar.h).toBeCloseTo(7 * 0.55 + 1, 6); // 4.85 mm
    expect(bar.y).toBeCloseTo(40 - 4.85, 6);
  });

  it("sel yang lebih tinggi punya area label identik (menempel dasar)", () => {
    const bar = sheetLabelBarMm(60, 7);
    expect(bar.h).toBeCloseTo(4.85, 6);
    expect(bar.y).toBeCloseTo(60 - 4.85, 6);
  });
});
