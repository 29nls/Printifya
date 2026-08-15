import { useMemo, useRef, useState } from "react";
import { printHtmlSheet } from "../../print-center/printer-lokal/printHtml";
import {
  buildCsv,
  buildSheetHtml,
  cellDisplay,
  COLS,
  colHeader,
  ROWS,
} from "./spreadsheet";
import "../../photo-studio/shared/style.css";
import "./style.css";

function emptyGrid(): string[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ""));
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

export default function ExcelSheetPage() {
  const [grid, setGrid] = useState<string[][]>(emptyGrid);
  const [sel, setSel] = useState({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [fx, setFx] = useState("");
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Nilai tampilan semua sel (formula dievaluasi sekali per perubahan grid).
  const display = useMemo(() => {
    const m: string[][] = [];
    for (let r = 0; r < ROWS; r++) {
      m.push([]);
      for (let c = 0; c < COLS; c++) {
        m[r].push(cellDisplay(grid[r][c], grid));
      }
    }
    return m;
  }, [grid]);

  const setCell = (r: number, c: number, v: string) => {
    setGrid((prev) => {
      const next = prev.map((row) => [...row]);
      next[r][c] = v;
      return next;
    });
  };

  const selectCell = (r: number, c: number) => {
    setSel({ r, c });
    setEditing(null);
    setFx(grid[r][c]);
    gridRef.current?.focus();
  };

  const commitFx = () => {
    // Bar formula: commit ke sel terpilih; mode in-cell: commit ke sel yang diedit.
    const target = editing ?? sel;
    setCell(target.r, target.c, fx);
    setEditing(null);
  };

  const cancelFx = () => {
    setFx(grid[sel.r][sel.c]);
    setEditing(null);
  };

  const startEdit = (r: number, c: number) => {
    setSel({ r, c });
    setEditing({ r, c });
    setFx(grid[r][c]);
  };

  const clearCell = () => {
    setCell(sel.r, sel.c, "");
    setFx("");
  };

  const move = (dr: number, dc: number) => {
    selectCell(clamp(sel.r + dr, 0, ROWS - 1), clamp(sel.c + dc, 0, COLS - 1));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(-1, 0); break;
      case "ArrowDown": e.preventDefault(); move(1, 0); break;
      case "ArrowLeft": e.preventDefault(); move(0, -1); break;
      case "ArrowRight": e.preventDefault(); move(0, 1); break;
      case "Delete": case "Backspace": e.preventDefault(); clearCell(); break;
      case "Enter": e.preventDefault(); startEdit(sel.r, sel.c); break;
      case "F2": e.preventDefault(); startEdit(sel.r, sel.c); break;
    }
  };

  const loadExample = () => {
    const g = emptyGrid();
    g[0][0] = "10";
    g[1][0] = "20";
    g[2][0] = "30";
    g[3][0] = "=SUM(A1:A3)";
    g[0][1] = "=A1*2";
    g[1][1] = "=AVERAGE(A1:A3)";
    g[2][1] = "=A3/0";
    g[3][1] = "=MAX(A1:A3)";
    g[0][2] = "Nama";
    g[1][2] = "Andi";
    g[2][2] = "Budi";
    setGrid(g);
    setSel({ r: 0, c: 0 });
    setEditing(null);
    setFx(g[0][0]);
    setError("");
  };

  const resetGrid = () => {
    setGrid(emptyGrid());
    setSel({ r: 0, c: 0 });
    setEditing(null);
    setFx("");
    setError("");
  };

  const handleCsv = () => {
    const csv = buildCsv(grid);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "spreadsheet.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handlePrint = () => {
    if (printing) return;
    setError("");
    setPrinting(true);
    try {
      const html = buildSheetHtml(grid);
      const ok = printHtmlSheet(html);
      if (!ok) setError("Tidak bisa membuat iframe cetak di browser ini.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="excel-page">
      <header className="module-header">
        <span className="module-icon">📊</span>
        <div>
          <h1>Excel Sheet</h1>
          <p>
            Spreadsheet sederhana dengan formula dasar (SUM, AVERAGE, MIN, MAX,
            COUNT, aritmatika &amp; referensi A1), ekspor CSV, dan cetak.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="excel-toolbar">
          <button type="button" className="btn" onClick={loadExample}>
            📊 Contoh Data
          </button>
          <button type="button" className="btn" onClick={resetGrid}>
            🗑️ Kosongkan
          </button>
          <span className="toolbar-spacer" />
          <button type="button" className="btn" onClick={handleCsv}>
            ⬇️ Ekspor CSV
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={printing}
            onClick={handlePrint}
          >
            {printing ? "Menyiapkan…" : "🖨️ Cetak / PDF"}
          </button>
        </div>

        <div className="formula-bar">
          <span className="fx-badge">fx</span>
          <input
            value={fx}
            placeholder="Ketik nilai atau formula, mis. =SUM(A1:A3), lalu Enter"
            onChange={(e) => setFx(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitFx();
              if (e.key === "Escape") cancelFx();
            }}
          />
        </div>

        <div
          className="grid-scroll"
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <table className="sheet-grid">
            <thead>
              <tr>
                <th className="corner"></th>
                {Array.from({ length: COLS }, (_, c) => (
                  <th key={c}>{colHeader(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: ROWS }, (_, r) => (
                <tr key={r}>
                  <th className="row-head">{r + 1}</th>
                  {Array.from({ length: COLS }, (_, c) => {
                    const isSel = sel.r === r && sel.c === c;
                    const isEdit = editing?.r === r && editing?.c === c;
                    const val = display[r][c];
                    const isNumber = /^-?\d/.test(val);
                    return (
                      <td
                        key={c}
                        className={
                          (isSel ? "selected " : "") + (isNumber ? "num" : "")
                        }
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectCell(r, c)}
                        onDoubleClick={() => startEdit(r, c)}
                      >
                        {isEdit ? (
                          <input
                            className="cell-input"
                            autoFocus
                            value={fx}
                            onChange={(e) => setFx(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitFx();
                              if (e.key === "Escape") cancelFx();
                            }}
                            onBlur={commitFx}
                          />
                        ) : (
                          <span
                            className={
                              /^#/.test(val)
                                ? "cell-err"
                                : val.startsWith("=")
                                  ? "cell-formula"
                                  : ""
                            }
                          >
                            {val}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p className="error">{error}</p>}
        <p className="hint">
          💡 Klik sel untuk memilih, ketik di bar formula lalu Enter, atau
          klik dua kali sel untuk mengedit langsung. Navigasi: panah, Delete,
          Enter, F2. Fungsi: SUM, AVERAGE, MIN, MAX, COUNT + rentang (A1:B3).
          Error umum: <code>#DIV/0!</code> (bagi nol), <code>#ERROR!</code>{" "}
          (sintaks / siklus).
        </p>
      </section>
    </div>
  );
}
