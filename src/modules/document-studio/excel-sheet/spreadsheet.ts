/**
 * Mesin spreadsheet ringan — tanpa dependency.
 *
 * - Dua lembar (Sheet1 / Sheet2) dengan referensi antar-lembar:
 *   "Sheet2!A1", rentang "Sheet2!A1:B3". Referensi tanpa nama lembar
 *   diartikan ke lembar tempat formula berada.
 * - Evaluator: aritmatika (+ - * /, kurung, unary), perbandingan
 *   (= <> < > <= >=), referensi sel & rentang, literal string, dan fungsi
 *   SUM / AVERAGE / MIN / MAX / COUNT / IF / CONCATENATE / LEN / ROUND /
 *   TODAY / NOW.
 * - TODAY/NOW mengembalikan serial tanggal Excel (hari sejak 1899-12-30);
 *   format "dd/mm/yyyy" dan "dd/mm/yyyy hh:mm" menampilkannya sebagai tanggal.
 * - Deteksi siklus (termasuk lintas lembar) dan error: "#DIV/0!", "#ERROR!".
 * - Format angka per sel: umum, desimal, persen, ribuan, tanggal.
 */

export const ROWS = 25;
export const COLS = 12;
export const SHEET_NAMES = ["Sheet1", "Sheet2"] as const;

/** Grid sel mentah (teks). */
export type SheetGrid = string[][];

/** Nilai hasil evaluasi: angka atau teks. NaN = error numerik. */
export type EvalValue = number | string;

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

/** Kunci kanonik sebuah sel, selalu berkualifikasi lembar (SHEET1!A1). */
function qualifiedKey(sheetIdx: number, r: number, c: number): string {
  return `${SHEET_NAMES[sheetIdx]}!${refKey(r, c)}`;
}

function sheetIndexByName(name: string): number {
  return SHEET_NAMES.findIndex((n) => n.toUpperCase() === name.toUpperCase());
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
    if (ch === '"') {
      let j = i + 1;
      let buf = '"';
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            buf += '""';
            j += 2;
            continue;
          }
          buf += '"';
          j++;
          break;
        }
        buf += src[j];
        j++;
      }
      tokens.push(buf);
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "<>" || two === "!=") {
      tokens.push(two);
      i += 2;
      continue;
    }
    if ("+-*/(),:<>=".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === "!") {
      tokens.push("!");
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
    tokens.push(ch);
    i++;
  }
  return tokens;
}

const REF_RE = /^[A-Za-z][0-9]+$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;

type GetRef = (key: string) => EvalValue;

function isErr(v: EvalValue): boolean {
  return typeof v === "number" && Number.isNaN(v);
}

function isTruthy(v: EvalValue): boolean {
  if (typeof v === "string") return v !== "";
  return v !== 0;
}

function compare(a: EvalValue, b: EvalValue, op: string): boolean {
  const bothNum =
    typeof a === "number" && typeof b === "number" && !isErr(a) && !isErr(b);
  const x: number | string = bothNum ? (a as number) : String(a);
  const y: number | string = bothNum ? (b as number) : String(b);
  switch (op) {
    case "=": return x === y;
    case "<>":
    case "!=": return x !== y;
    case "<": return x < y;
    case ">": return x > y;
    case "<=": return x <= y;
    case ">=": return x >= y;
    default: return false;
  }
}

/** Serial tanggal Excel: hari sejak 1899-12-30 (epoch UTC). */
function serialFromEpochMs(ms: number): number {
  const epoch = Date.UTC(1899, 11, 30);
  return (ms - epoch) / 86400000;
}

function todaySerial(): number {
  const d = new Date();
  return serialFromEpochMs(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  );
}

function nowSerial(): number {
  return serialFromEpochMs(Date.now());
}

/** Kumpulkan nilai sel dalam rentang; sel kosong & error dilewati. */
function collectRange(
  sheetName: string | undefined,
  aKey: string,
  bKey: string,
  grids: SheetGrid[],
  currentSheet: number,
  getRef: GetRef
): EvalValue[] {
  const sheetIdx =
    sheetName !== undefined ? sheetIndexByName(sheetName) : currentSheet;
  const grid = sheetIdx >= 0 ? grids[sheetIdx] : undefined;
  if (!grid) return [];
  const a = parseRef(aKey);
  const b = parseRef(bKey);
  const r1 = Math.min(a.r, b.r);
  const r2 = Math.max(a.r, b.r);
  const c1 = Math.min(a.c, b.c);
  const c2 = Math.max(a.c, b.c);
  const values: EvalValue[] = [];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) continue;
      const raw = grid[r][c];
      if (!raw || !raw.trim()) continue;
      const key =
        sheetName !== undefined ? `${sheetName}!${refKey(r, c)}` : refKey(r, c);
      const v = getRef(key.toUpperCase());
      if (!isErr(v)) values.push(v);
    }
  }
  return values;
}

function applyFunction(name: string, args: EvalValue[]): EvalValue {
  if (args.some(isErr)) return NaN;

  const nums = args.filter(
    (a): a is number => typeof a === "number" && Number.isFinite(a)
  );
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
    case "IF":
      if (args.length < 3) return NaN;
      return isTruthy(args[0]) ? args[1] : args[2];
    case "CONCATENATE":
      return args.map((a) => String(a)).join("");
    case "LEN": {
      const a = args[0];
      return a === undefined ? NaN : String(a).length;
    }
    case "ROUND": {
      const x = args[0];
      const d = args[1] ?? 0;
      if (typeof x !== "number" || typeof d !== "number") return NaN;
      const f = Math.pow(10, Math.trunc(d));
      return Math.round(x * f) / f;
    }
    case "TODAY":
      return todaySerial();
    case "NOW":
      return nowSerial();
    default:
      return NaN; // fungsi tak dikenal → #ERROR!
  }
}

class ExprParser {
  private pos = 0;

  constructor(
    private tokens: string[],
    private getRef: GetRef,
    private grids: SheetGrid[],
    private currentSheet: number
  ) {}

  private peek(): string | undefined {
    return this.tokens[this.pos];
  }

  private next(): string | undefined {
    return this.tokens[this.pos++];
  }

  parse(): EvalValue {
    const v = this.cmp();
    if (this.pos < this.tokens.length) throw new Error("sisa token");
    return v;
  }

  private cmp(): EvalValue {
    const left = this.add();
    const op = this.peek();
    if (
      op === "=" ||
      op === "<>" ||
      op === "!=" ||
      op === "<" ||
      op === ">" ||
      op === "<=" ||
      op === ">="
    ) {
      this.next();
      const right = this.add();
      return compare(left, right, op) ? 1 : 0;
    }
    return left;
  }

  private add(): EvalValue {
    let v = this.term();
    for (;;) {
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.next();
      const t = this.term();
      if (typeof v === "string" || typeof t === "string") return NaN;
      v = op === "+" ? (v as number) + (t as number) : (v as number) - (t as number);
    }
    return v;
  }

  private term(): EvalValue {
    let v = this.unary();
    for (;;) {
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.next();
      const t = this.unary();
      if (typeof v === "string" || typeof t === "string") return NaN;
      v = op === "*" ? (v as number) * (t as number) : (v as number) / (t as number);
    }
    return v;
  }

  private unary(): EvalValue {
    const op = this.peek();
    if (op === "-" || op === "+") {
      this.next();
      const v = this.unary();
      if (typeof v === "string") return NaN;
      return op === "-" ? -(v as number) : (v as number);
    }
    return this.primary();
  }

  /** Deteksi argumen rentang di posisi sekarang: A1:B3 atau Sheet2!A1:B3. */
  private peekRange(): { sheet?: string; a: string; b: string } | null {
    const t = this.tokens;
    const p = this.pos;
    if (
      NAME_RE.test(t[p] ?? "") &&
      t[p + 1] === "!" &&
      REF_RE.test(t[p + 2] ?? "") &&
      t[p + 3] === ":" &&
      REF_RE.test(t[p + 4] ?? "")
    ) {
      return { sheet: t[p].toUpperCase(), a: t[p + 2], b: t[p + 4] };
    }
    if (
      REF_RE.test(t[p] ?? "") &&
      t[p + 1] === ":" &&
      REF_RE.test(t[p + 2] ?? "")
    ) {
      return { a: t[p], b: t[p + 2] };
    }
    return null;
  }

  private primary(): EvalValue {
    const t = this.next();
    if (t === undefined) throw new Error("ekspresi selesai");
    if (t === "(") {
      const v = this.cmp();
      if (this.next() !== ")") throw new Error("kurung tak tertutup");
      return v;
    }
    if (t.startsWith('"')) {
      const inner = t.slice(1, -1);
      return inner.replace(/""/g, '"');
    }
    if (/^[0-9.]/.test(t)) {
      const n = Number(t);
      return Number.isFinite(n) ? n : NaN;
    }
    if (NAME_RE.test(t)) {
      // Referensi berkualifikasi lembar: Sheet2!A1
      if (this.peek() === "!") {
        this.next();
        const refToken = this.next();
        if (refToken === undefined || !REF_RE.test(refToken))
          throw new Error("referensi lembar salah");
        return this.getRef(`${t.toUpperCase()}!${refToken.toUpperCase()}`);
      }
      // Panggilan fungsi?
      if (this.peek() === "(") {
        this.next();
        const fnName = t.toUpperCase();
        const args: EvalValue[] = [];
        if (this.peek() !== ")") {
          for (;;) {
            const range = this.peekRange();
            if (range) {
              if (range.sheet !== undefined) {
                this.next(); // nama lembar
                this.next(); // "!"
                this.next(); // ref awal
              } else {
                this.next(); // ref awal
              }
              this.next(); // ":"
              const b = this.next()!;
              args.push(
                ...collectRange(
                  range.sheet,
                  range.a,
                  b,
                  this.grids,
                  this.currentSheet,
                  this.getRef
                )
              );
            } else {
              args.push(this.cmp());
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
  grids: SheetGrid[],
  currentSheet: number,
  getRef: GetRef,
  stack: Set<string>
): EvalValue {
  const bang = key.indexOf("!");
  let sheetIdx: number;
  let refPart: string;
  if (bang >= 0) {
    const idx = sheetIndexByName(key.slice(0, bang));
    if (idx < 0) return NaN;
    sheetIdx = idx;
    refPart = key.slice(bang + 1);
  } else {
    sheetIdx = currentSheet;
    refPart = key;
  }
  const grid = grids[sheetIdx];
  if (!grid) return NaN;
  const { r, c } = parseRef(refPart);
  if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length) return NaN;
  const raw = grid[r][c];
  if (!raw || !raw.trim()) return 0;
  const k = qualifiedKey(sheetIdx, r, c).toUpperCase();
  if (stack.has(k)) return NaN; // siklus (lintas lembar)
  stack.add(k);
  const v = evaluateRaw(raw, grids, sheetIdx, getRef, stack);
  stack.delete(k);
  return v;
}

/**
 * Evaluasi teks sel menjadi angka atau teks.
 * `sheetIdx` = lembar tempat formula berada (untuk referensi tanpa nama).
 */
export function evaluateRaw(
  raw: string,
  grids: SheetGrid[],
  sheetIdx = 0,
  getRef?: GetRef,
  stack?: Set<string>
): EvalValue {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const s = stack ?? new Set<string>();
  if (trimmed.startsWith("=")) {
    const ref: GetRef =
      getRef ?? ((key) => getRefValue(key, grids, sheetIdx, ref, s));
    const tokens = tokenize(trimmed.slice(1));
    try {
      return new ExprParser(tokens, ref, grids, sheetIdx).parse();
    } catch {
      return NaN;
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  return trimmed; // teks
}

function fmtNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s;
}

/** Serial tanggal Excel → "15/08/2026" atau "15/08/2026 14:30". */
function formatSerialDate(serial: number, withTime: boolean): string {
  const ms = (serial - 25569) * 86400000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  if (!withTime) return date;
  let frac = serial - Math.floor(serial);
  if (frac < 0) frac += 1;
  const h = Math.floor(frac * 24);
  const m = Math.floor((frac * 24 - h) * 60);
  return `${date} ${pad(h)}:${pad(m)}`;
}

/** Format angka sesuai kode format sederhana. */
function formatNumber(n: number, fmt: string): string {
  if (fmt === "dd/mm/yyyy" || fmt === "dd/mm/yyyy hh:mm") {
    return formatSerialDate(n, fmt.includes("hh:mm"));
  }
  const pct = fmt.includes("%");
  const value = pct ? n * 100 : n;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const dotIdx = fmt.indexOf(".");
  const decimals =
    dotIdx >= 0 ? fmt.slice(dotIdx + 1).replace(/[^0]/g, "").length : 0;
  let s = abs.toFixed(decimals);
  if (fmt.includes(",")) {
    const [intPart, fracPart] = s.split(".");
    s =
      intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
      (fracPart !== undefined ? "." + fracPart : "");
  }
  return sign + s + (pct ? "%" : "");
}

/**
 * Nilai tampilan sebuah sel. `format` = kode format ("", "0.00", "0.0%",
 * "#,##0", "dd/mm/yyyy", …) yang berlaku untuk hasil numerik.
 */
export function cellDisplay(
  raw: string,
  grids: SheetGrid[],
  sheetIdx = 0,
  format?: string
): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  const stack = new Set<string>();
  const getRef: GetRef = (key) => getRefValue(key, grids, sheetIdx, getRef, stack);
  const v = evaluateRaw(trimmed, grids, sheetIdx, getRef, stack);
  if (typeof v === "string") return v;
  if (Number.isNaN(v)) return "#ERROR!";
  if (!Number.isFinite(v)) return "#DIV/0!";
  return format && format !== "general"
    ? formatNumber(v, format)
    : fmtNumber(v);
}

/** Batas baris/kolom terakhir yang berisi data pada sebuah lembar. */
function usedBounds(grid: SheetGrid): { r: number; c: number } {
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

export type FormatAccessor = (r: number, c: number) => string | undefined;

/** Ekspor lembar aktif (nilai tampilan) ke CSV, dengan BOM untuk Excel. */
export function buildCsv(
  grids: SheetGrid[],
  sheetIdx: number,
  getFormat?: FormatAccessor
): string {
  const grid = grids[sheetIdx];
  const { r: lastR, c: lastC } = usedBounds(grid);
  if (lastR < 0) return "\uFEFF";
  const rows: string[] = [];
  for (let r = 0; r <= lastR; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= lastC; c++) {
      cells.push(csvCell(cellDisplay(grid[r][c], grids, sheetIdx, getFormat?.(r, c))));
    }
    rows.push(cells.join(","));
  }
  return "\uFEFF" + rows.join("\r\n");
}

/** HTML A4 landscape siap cetak (pola iframe print) untuk lembar aktif. */
export function buildSheetHtml(
  grids: SheetGrid[],
  sheetIdx: number,
  getFormat?: FormatAccessor
): string {
  const grid = grids[sheetIdx];
  const { r: lastR, c: lastC } = usedBounds(grid);
  const rows = Math.max(1, lastR + 1);
  const cols = Math.max(1, lastC + 1);

  const head = `<tr><th></th>${Array.from(
    { length: cols },
    (_, c) => `<th>${colHeader(c)}</th>`
  ).join("")}</tr>`;

  const body = Array.from({ length: rows }, (_, r) => {
    const cells = Array.from({ length: cols }, (_, c) => {
      const v = cellDisplay(grid[r][c], grids, sheetIdx, getFormat?.(r, c));
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
