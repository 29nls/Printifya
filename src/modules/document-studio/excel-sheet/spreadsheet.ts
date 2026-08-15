/**
 * Mesin spreadsheet ringan — tanpa dependency.
 *
 * - Sel menyimpan teks mentah: angka, teks, atau formula ("=...").
 * - Evaluator mendukung aritmatika (+ - * /, kurung, unary), referensi sel
 *   (A1), rentang (A1:B3), dan fungsi SUM / AVERAGE / MIN / MAX / COUNT.
 * - Deteksi siklus (referensi melingkar) dan error: "#DIV/0!", "#ERROR!".
 */

export const ROWS = 25;
export const COLS = 12;

function colLetters(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Label kolom header, mis. "A", "B", "L". */
export const colHeader = (c: number): string => colLetters(c);

export function parseRef(key: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(key.toUpperCase());
  if (!m) return { r: -1, c: -1 };
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

function refKey(r: number, c: number): string {
  return `${colLetters(c)}${r + 1}`;
}

/* ---------------- Tokenizer & parser ekspresi ---------------- */

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/(),:".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9]/.test(src[j])) j++;
      tokens.push(src.slice(i, j));
      i = j;
      continue;
    }
    tokens.push(ch); // karakter tak dikenal → token error
    i++;
  }
  return tokens;
}

const REF_RE = /^[A-Za-z][0-9]+$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

type GetRef = (key: string) => number;

function collectRange(
  aKey: string,
  bKey: string,
  grid: string[][],
  getRef: GetRef
): number[] {
  const a = parseRef(aKey);
  const b = parseRef(bKey);
  const r1 = Math.min(a.r, b.r);
  const r2 = Math.max(a.r, b.r);
  const c1 = Math.min(a.c, b.c);
  const c2 = Math.max(a.c, b.c);
  const values: number[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) continue;
      const raw = grid[r][c];
      if (!raw || !raw.trim()) continue;
      values.push(getRef(refKey(r, c)));
    }
  }
  return values;
}

function applyFunction(name: string, args: number[]): number {
  const nums = args.filter((a) => Number.isFinite(a));
  switch (name) {
    case "SUM":
      return nums.reduce((s, a) => s + a, 0);
    case "AVERAGE":
      return nums.length ? nums.reduce((s, a) => s + a, 0) / nums.length : NaN;
    case "MIN":
      return nums.length ? Math.min(...nums) : NaN;
    case "MAX":
      return nums.length ? Math.max(...nums) : NaN;
    case "COUNT":
      return nums.length;
    default:
      return NaN; // fungsi tak dikenal → #ERROR!
  }
}

class ExprParser {
  private pos = 0;

  constructor(
    private tokens: string[],
    private getRef: GetRef,
    private grid: string[][]
  ) {}

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private next(): string | undefined {
    return this.tokens[this.pos++];
  }

  parse(): number {
    const v = this.expr();
    if (this.pos < this.tokens.length) throw new Error("sisa token");
    return v;
  }

  private expr(): number {
    let v = this.term();
    for (;;) {
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.next();
      const t = this.term();
      v = op === "+" ? v + t : v - t;
    }
    return v;
  }

  private term(): number {
    let v = this.unary();
    for (;;) {
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.next();
      const t = this.unary();
      v = op === "*" ? v * t : v / t;
    }
    return v;
  }

  private unary(): number {
    const op = this.peek();
    if (op === "-" || op === "+") {
      this.next();
      const v = this.unary();
      return op === "-" ? -v : v;
    }
    return this.primary();
  }

  private primary(): number {
    const t = this.next();
    if (t === undefined) throw new Error("ekspresi selesai");
    if (t === "(") {
      const v = this.expr();
      if (this.next() !== ")") throw new Error("kurung tak tertutup");
      return v;
    }
    if (/^[0-9.]/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    }
    if (NAME_RE.test(t)) {
      // Panggilan fungsi?
      if (this.peek() === "(") {
        this.next();
        const fnName = t.toUpperCase();
        const args: number[] = [];
        if (this.peek() !== ")") {
          for (;;) {
            // Argumen rentang "A1:B3"?
            if (
              REF_RE.test(this.peek() ?? "") &&
              this.tokens[this.pos + 1] === ":" &&
              REF_RE.test(this.tokens[this.pos + 2] ?? "")
            ) {
              const a = this.next()!;
              this.next();
              const b = this.next()!;
              args.push(...collectRange(a, b, this.grid, this.getRef));
            } else {
              args.push(this.expr());
            }
            if (this.peek() === ",") {
              this.next();
              continue;
            }
            break;
          }
        }
        if (this.next() !== ")") throw new Error("kurung fungsi tak tertutup");
        return applyFunction(fnName, args);
      }
      // Referensi sel (A1)?
      if (REF_RE.test(t)) {
        return this.getRef(t.toUpperCase());
      }
      throw new Error("nama tak dikenal");
    }
    throw new Error("token tak dikenal");
  }
}

/* ---------------- Evaluasi ---------------- */

function getRefValue(
  key: string,
  grid: string[][],
  getRef: GetRef,
  stack: Set<string>
): number {
  const { r, c } = parseRef(key);
  if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) return NaN;
  const raw = grid[r][c];
  if (!raw || !raw.trim()) return 0;
  const k = key.toUpperCase();
  if (stack.has(k)) return NaN; // siklus
  stack.add(k);
  const v = evaluateRaw(raw, grid, getRef, stack);
  stack.delete(k);
  return v;
}

/** Evaluasi teks sel menjadi angka (NaN = error). */
export function evaluateRaw(
  raw: string,
  grid: string[][],
  getRef?: GetRef,
  stack?: Set<string>
): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const s = stack ?? new Set<string>();
  if (trimmed.startsWith("=")) {
    const ref: GetRef =
      getRef ?? ((key) => getRefValue(key, grid, ref, s));
    const tokens = tokenize(trimmed.slice(1));
    try {
      return new ExprParser(tokens, ref, grid).parse();
    } catch {
      return NaN;
    }
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s;
}

/** Nilai tampilan sebuah sel (formula dievaluasi; error ditampilkan). */
export function cellDisplay(raw: string, grid: string[][]): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed.startsWith("=")) {
    const stack = new Set<string>();
    const getRef: GetRef = (key) => getRefValue(key, grid, getRef, stack);
    const v = evaluateRaw(trimmed, grid, getRef, stack);
    if (Number.isNaN(v)) return "#ERROR!";
    if (!Number.isFinite(v)) return "#DIV/0!";
    return fmtNumber(v);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? fmtNumber(n) : trimmed;
  }
  return raw;
}

/** Batas baris/kolom terakhir yang berisi data (untuk CSV & cetak). */
function usedBounds(grid: string[][]): { r: number; c: number } {
  let r = -1;
  let c = -1;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (grid[i][j].trim() !== "") {
        r = Math.max(r, i);
        c = Math.max(c, j);
      }
    }
  }
  return { r, c };
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Ekspor grid (nilai tampilan) ke CSV, dengan BOM untuk Excel. */
export function buildCsv(grid: string[][]): string {
  const { r: lastR, c: lastC } = usedBounds(grid);
  if (lastR < 0) return "\uFEFF";
  const rows: string[] = [];
  for (let r = 0; r <= lastR; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= lastC; c++) {
      cells.push(csvCell(cellDisplay(grid[r][c], grid)));
    }
    rows.push(cells.join(","));
  }
  return "\uFEFF" + rows.join("\r\n");
}

/** HTML A4 landscape siap cetak (pola iframe print). */
export function buildSheetHtml(grid: string[][]): string {
  const { r: lastR, c: lastC } = usedBounds(grid);
  const rows = Math.max(1, lastR + 1);
  const cols = Math.max(1, lastC + 1);

  const head = `<tr><th></th>${Array.from(
    { length: cols },
    (_, c) => `<th>${colHeader(c)}</th>`
  ).join("")}</tr>`;

  const body = Array.from({ length: rows }, (_, r) => {
    const cells = Array.from({ length: cols }, (_, c) => {
      const v = cellDisplay(grid[r][c], grid);
      const cls = /^#/.test(v) ? ' class="err"' : "";
      return `<td${cls}>${v.replace(/[<>&]/g, (ch) =>
        ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&amp;"
      )}</td>`;
    }).join("");
    return `<tr><th>${r + 1}</th>${cells}</tr>`;
  }).join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Spreadsheet</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: Calibri, Arial, sans-serif; font-size: 9pt; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #888; padding: 3px 8px; min-width: 48px; }
  th { background: #e8e8e8; font-weight: 600; }
  td.err { color: #b91c1c; font-weight: 600; }
</style>
</head>
<body>
<table>
${head}
${body}
</table>
</body>
</html>`;
}
