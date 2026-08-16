import { describe, expect, it } from "vitest";
import {
  buildCsv,
  cellDisplay,
  colHeader,
  evaluateRaw,
  type SheetGrid,
} from "./spreadsheet";

/** Grid kecil untuk tes (evaluator memeriksa batas dinamis). */
function g(rows: string[][]): SheetGrid {
  return rows;
}

/** Dua lembar; Sheet2 kosong kecuali diisi. */
function twoSheets(rows1: string[][], rows2: string[][] = []): SheetGrid[] {
  return [g(rows1), g(rows2)];
}

describe("evaluateRaw — literal & aritmatika", () => {
  it("angka polos, teks, dan sel kosong", () => {
    const grids = [g([])];
    expect(evaluateRaw("42", grids)).toBe(42);
    expect(evaluateRaw("-7", grids)).toBe(-7);
    expect(evaluateRaw("3.14", grids)).toBe(3.14);
    expect(evaluateRaw("abc", grids)).toBe("abc");
    expect(evaluateRaw("", grids)).toBe(0);
    expect(evaluateRaw("   ", grids)).toBe(0);
  });

  it("prioritas operator & kurung", () => {
    const grids = [g([])];
    expect(evaluateRaw("=1+2*3", grids)).toBe(7);
    expect(evaluateRaw("=(1+2)*3", grids)).toBe(9);
    expect(evaluateRaw("=10/4", grids)).toBe(2.5);
    expect(evaluateRaw("=10-4-3", grids)).toBe(3);
    expect(evaluateRaw("=-5+3", grids)).toBe(-2);
    expect(evaluateRaw("=+5", grids)).toBe(5);
  });

  it("pembagian nol → Infinity (tampil #DIV/0!), bukan NaN", () => {
    const grids = [g([])];
    expect(evaluateRaw("=1/0", grids)).toBe(Infinity);
    expect(cellDisplay("=1/0", grids)).toBe("#DIV/0!");
  });

  it("token tak dikenal / nama salah → NaN (#ERROR!)", () => {
    const grids = [g([])];
    expect(evaluateRaw("=abc", grids)).toBeNaN();
    expect(cellDisplay("=abc", grids)).toBe("#ERROR!");
  });

  it("string literal dengan kutip ganda ter-escape", () => {
    const grids = [g([])];
    expect(evaluateRaw('="a""b"', grids)).toBe('a"b');
  });
});

describe("evaluateRaw — perbandingan", () => {
  it("= <> < > <= >= menghasilkan 1/0", () => {
    const grids = [g([])];
    expect(evaluateRaw("=3=3", grids)).toBe(1);
    expect(evaluateRaw("=3<>4", grids)).toBe(1);
    expect(evaluateRaw("=5<3", grids)).toBe(0);
    expect(evaluateRaw("=5>=5", grids)).toBe(1);
    expect(evaluateRaw('="a"="a"', grids)).toBe(1);
    expect(evaluateRaw('="a"<"b"', grids)).toBe(1);
    expect(evaluateRaw("=1<=0", grids)).toBe(0);
  });
});

describe("evaluateRaw — referensi sel & rentang", () => {
  it("referensi mengevaluasi isi sel (cascading formula)", () => {
    const grids = [g([["=A2*2"], ["21"]])];
    expect(evaluateRaw("=A1", grids)).toBe(42);
  });

  it("sel kosong → 0; sel di luar batas → NaN", () => {
    const grids = [g([["=B1+5", ""], ["", ""]])]; // B1 kosong, dalam batas
    expect(evaluateRaw("=B1+5", grids)).toBe(5);
    expect(evaluateRaw("=Z99", grids)).toBeNaN();
    expect(evaluateRaw("=A5", grids)).toBeNaN(); // di luar 2 baris
  });

  it("teks dalam konteks angka → NaN (#ERROR!)", () => {
    const grids = [g([["abc", "=A1+1"]])];
    expect(evaluateRaw("=A1+1", grids)).toBeNaN();
    expect(cellDisplay("=A1+1", grids)).toBe("#ERROR!");
  });
});

describe("evaluateRaw — fungsi", () => {
  it("SUM rentang, teks & kosong dilewati", () => {
    const grids = [g([["1", "2", "3"], ["4", "5", "x"], ["", "6"]])];
    // A1:B3 = 1+4+2+5+6 = 18 (A3 kosong & sel teks "x" dilewati)
    expect(evaluateRaw("=SUM(A1:B3)", grids)).toBe(18);
    expect(evaluateRaw("=SUM(A1:C1)", grids)).toBe(6);
  });

  it("AVERAGE/MIN/MAX/COUNT", () => {
    const grids = [g([["1", "2", "3", "4"]])];
    expect(evaluateRaw("=AVERAGE(A1:D1)", grids)).toBe(2.5);
    expect(evaluateRaw("=MIN(A1:D1)", grids)).toBe(1);
    expect(evaluateRaw("=MAX(A1:D1)", grids)).toBe(4);
    expect(evaluateRaw("=COUNT(A1:D1)", grids)).toBe(4);
  });

  it("AVERAGE rentang kosong → NaN; SUM kosong → 0", () => {
    const grids = [g([["1", "2"]])];
    expect(evaluateRaw("=SUM(C1:E1)", grids)).toBe(0); // semua kosong
    expect(evaluateRaw("=AVERAGE(C1:E1)", grids)).toBeNaN();
  });

  it("IF dengan kondisi & percabangan", () => {
    const grids = [g([["5"]])];
    expect(evaluateRaw('=IF(A1>3,"besar","kecil")', grids)).toBe("besar");
    expect(evaluateRaw('=IF(A1>10,"besar","kecil")', grids)).toBe("kecil");
    expect(evaluateRaw('=IF(1,"x","y")', grids)).toBe("x");
    expect(evaluateRaw('=IF(0,"x","y")', grids)).toBe("y");
  });

  it("CONCATENATE (angka ikut di-String) & LEN", () => {
    const grids = [g([])];
    expect(evaluateRaw('=CONCATENATE("a","b",1)', grids)).toBe("ab1");
    expect(evaluateRaw('=LEN("abc")', grids)).toBe(3);
    expect(evaluateRaw("=LEN(123)", grids)).toBe(3);
  });

  it("ROUND (termasuk digit negatif)", () => {
    const grids = [g([])];
    expect(evaluateRaw("=ROUND(3.14159,2)", grids)).toBe(3.14);
    expect(evaluateRaw("=ROUND(2.5,0)", grids)).toBe(3);
    expect(evaluateRaw("=ROUND(1234,-2)", grids)).toBe(1200);
  });

  it("TODAY/NOW → serial tanggal (hari sejak 1899-12-30)", () => {
    const grids = [g([])];
    const today = evaluateRaw("=TODAY()", grids);
    const now = evaluateRaw("=NOW()", grids);
    expect(typeof today).toBe("number");
    expect(Number.isInteger(today)).toBe(true);
    expect(today as number).toBeGreaterThan(40000); // ≥ ~2009
    expect((now as number) - (today as number)).toBeGreaterThanOrEqual(0);
    expect((now as number) - (today as number)).toBeLessThan(1);
  });

  it("fungsi tak dikenal → NaN", () => {
    const grids = [g([])];
    expect(evaluateRaw("=FOO(1)", grids)).toBeNaN();
  });
});

describe("evaluateRaw — referensi antar-lembar", () => {
  it("Sheet2!A1 dalam formula Sheet1", () => {
    const grids = twoSheets([["=Sheet2!A1*3"]], [["7"]]);
    expect(evaluateRaw("=Sheet2!A1*3", grids, 0)).toBe(21);
  });

  it("rentang lintas lembar SUM(Sheet2!A1:B2)", () => {
    const grids = twoSheets([["=SUM(Sheet2!A1:B2)"]], [["1", "2"], ["3", "4"]]);
    expect(evaluateRaw("=SUM(Sheet2!A1:B2)", grids, 0)).toBe(10);
  });

  it("referensi tanpa nama lembar → lembar formula berada", () => {
    const grids = twoSheets([["=A1+1"]], [["41"]]);
    expect(evaluateRaw("=A1+1", grids, 1)).toBe(42); // Sheet2: A1 kosong → 0 + 1? A1 = "41" di baris 0
  });

  it("lembar tak dikenal: referensi tunggal → NaN; rentang → kosong (0)", () => {
    const grids = twoSheets([["=Sheet9!A1", "=SUM(Sheet9!A1:B1)"]], []);
    expect(evaluateRaw("=Sheet9!A1", grids, 0)).toBeNaN();
    expect(evaluateRaw("=SUM(Sheet9!A1:B1)", grids, 0)).toBe(0);
  });
});

describe("evaluateRaw — deteksi siklus", () => {
  it("siklus satu lembar A1↔B1 → NaN", () => {
    const grids = [g([["=B1", "=A1"]])];
    expect(evaluateRaw("=A1", grids)).toBeNaN();
    expect(cellDisplay("=A1", grids)).toBe("#ERROR!");
  });

  it("siklus lintas lembar → NaN", () => {
    const grids = twoSheets([["=Sheet2!B1"]], [["=Sheet1!A1"]]);
    expect(evaluateRaw("=Sheet2!B1", grids, 0)).toBeNaN();
  });
});

describe("cellDisplay — format angka & tanggal", () => {
  it("tanpa format: fmtNumber rapi (integer tanpa desimal)", () => {
    const grids = [g([])];
    expect(cellDisplay("3.14159", grids)).toBe("3.14159");
    expect(cellDisplay("42", grids)).toBe("42");
    expect(cellDisplay("0.5", grids)).toBe("0.5");
  });

  it("desimal & persen", () => {
    const grids = [g([])];
    expect(cellDisplay("3.14159", grids, 0, "0.00")).toBe("3.14");
    expect(cellDisplay("0.5", grids, 0, "0.0%")).toBe("50.0%");
  });

  it("pemisah ribuan (termasuk negatif)", () => {
    const grids = [g([])];
    expect(cellDisplay("1234567", grids, 0, "#,##0")).toBe("1,234,567");
    expect(cellDisplay("-1234567.5", grids, 0, "#,##0")).toBe("-1,234,568");
  });

  it("format tanggal dd/mm/yyyy dan dd/mm/yyyy hh:mm (serial 0 = 30/12/1899)", () => {
    const grids = [g([])];
    expect(cellDisplay("0", grids, 0, "dd/mm/yyyy")).toBe("30/12/1899");
    expect(cellDisplay("0.5", grids, 0, "dd/mm/yyyy hh:mm")).toBe(
      "30/12/1899 12:00"
    );
    expect(cellDisplay("=TODAY()", grids, 0, "dd/mm/yyyy")).toMatch(
      /^\d{2}\/\d{2}\/\d{4}$/
    );
  });

  it("teks tetap teks; format general = tanpa format", () => {
    const grids = [g([])];
    expect(cellDisplay("halo", grids, 0, "0.00")).toBe("halo");
    expect(cellDisplay("1.5", grids, 0, "general")).toBe("1.5");
  });
});

describe("colHeader & buildCsv", () => {
  it("colHeader: A, Z, AA, L", () => {
    expect(colHeader(0)).toBe("A");
    expect(colHeader(25)).toBe("Z");
    expect(colHeader(26)).toBe("AA");
    expect(colHeader(11)).toBe("L");
  });

  it("CSV: BOM + CRLF, nilai tampilan ter-format, koma/kutip ter-escape", () => {
    const grids = [g([["=1+1", 'a"b,c'], ["3", "4"]])];
    const csv = buildCsv(grids, 0);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("2,"); // =1+1 → "2"
    expect(csv).toContain('"a""b,c"'); // koma & kutip → dikutip + ganda
    expect(csv.includes("\r\n")).toBe(true); // dua baris → CRLF
  });

  it("CSV: lembar kosong → BOM saja", () => {
    expect(buildCsv([g([])], 0)).toBe("\uFEFF");
  });
});
