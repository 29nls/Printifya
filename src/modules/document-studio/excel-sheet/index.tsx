import { useEffect, useMemo, useRef, useState } from "react";
import { printHtmlSheet } from "../../print-center/printer-lokal/printHtml";
import { downloadUrl } from "../../shared/downloadUrl";
import {
  buildCsv,
  buildSheetHtml,
  cellDisplay,
  COLS,
  colHeader,
  ROWS,
  SHEET_NAMES,
  type SheetGrid,
} from "./spreadsheet";
import "../../photo-studio/shared/style.css";
import "./style.css";

function emptyGrid(): string[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => ""));
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const NUMBER_FORMATS = [
  { value: "", label: "Umum" },
  { value: "0", label: "0 (bulat)" },
  { value: "0.0", label: "1 desimal" },
  { value: "0.00", label: "2 desimal" },
  { value: "0.0%", label: "Persen (%)" },
  { value: "#,##0", label: "Ribuan" },
  { value: "dd/mm/yyyy", label: "Tanggal (dd/mm/yyyy)" },
  { value: "dd/mm/yyyy hh:mm", label: "Tanggal & jam" },
];

export default function ExcelSheetPage() {
  const [grids, setGrids] = useState<SheetGrid[]>(() => [
    emptyGrid(),
    emptyGrid(),
  ]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [formats, setFormats] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<Record<number, { r: number; c: number }>>({
    0: { r: 0, c: 0 },
    1: { r: 0, c: 0 },
  });
  const [extent, setExtent] = useState<Record<number, { r: number; c: number }>>({
    0: { r: 0, c: 0 },
    1: { r: 0, c: 0 },
  });
  const [editing, setEditing] = useState<{ r: number; c: number } | null>(null);
  const [fx, setFx] = useState("");
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const cur = sel[activeSheet] ?? { r: 0, c: 0 };

  // Rentang terpilih (ternormalisasi) pada lembar aktif.
  const range = (() => {
    const a = sel[activeSheet] ?? { r: 0, c: 0 };
    const b = extent[activeSheet] ?? a;
    return {
      r1: Math.min(a.r, b.r),
      r2: Math.max(a.r, b.r),
      c1: Math.min(a.c, b.c),
      c2: Math.max(a.c, b.c),
    };
  })();
  const isMulti = range.r1 !== range.r2 || range.c1 !== range.c2;

  // Hentikan drag saat tombol mouse dilepas di mana pun.
  useEffect(() => {
    const up = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Nilai tampilan semua sel tiap lembar (formula dievaluasi sekali per perubahan).
  const display = useMemo(() => {
    return grids.map((g, s) => {
      const m: string[][] = [];
      for (let r = 0; r < ROWS; r++) {
        m.push([]);
        for (let c = 0; c < COLS; c++) {
          m[r].push(cellDisplay(g[r][c], grids, s, formats[`${s},${r},${c}`]));
        }
      }
      return m;
    });
  }, [grids, formats]);

  const applyFormat = (fmt: string) => {
    const { r1, r2, c1, c2 } = range;
    setFormats((prev) => {
      const next = { ...prev };
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const key = `${activeSheet},${r},${c}`;
          if (fmt === "" || fmt === "general") delete next[key];
          else next[key] = fmt;
        }
      }
      return next;
    });
  };

  const setCell = (r: number, c: number, v: string) => {
    setGrids((prev) => {
      const next = prev.map((g) => g.map((row) => [...row]));
      next[activeSheet][r][c] = v;
      return next;
    });
  };

  const selectCell = (r: number, c: number) => {
    setSel((prev) => ({ ...prev, [activeSheet]: { r, c } }));
    setExtent((prev) => ({ ...prev, [activeSheet]: { r, c } }));
    setEditing(null);
    setFx(grids[activeSheet][r][c]);
    gridRef.current?.focus();
  };

  const extendTo = (r: number, c: number) => {
    setExtent((prev) => ({ ...prev, [activeSheet]: { r, c } }));
  };

  const commitFx = () => {
    // Bar formula: commit ke sel terpilih; mode in-cell: commit ke sel yang diedit.
    const target = editing ?? cur;
    setCell(target.r, target.c, fx);
    setEditing(null);
  };

  const cancelFx = () => {
    setFx(grids[activeSheet][cur.r][cur.c]);
    setEditing(null);
  };

  const startEdit = (r: number, c: number) => {
    setSel((prev) => ({ ...prev, [activeSheet]: { r, c } }));
    setExtent((prev) => ({ ...prev, [activeSheet]: { r, c } }));
    setEditing({ r, c });
    setFx(grids[activeSheet][r][c]);
  };

  const clearRange = () => {
    const { r1, r2, c1, c2 } = range;
    setGrids((prev) => {
      const next = prev.map((g) => g.map((row) => [...row]));
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) next[activeSheet][r][c] = "";
      }
      return next;
    });
    setFx("");
  };

  const move = (dr: number, dc: number) => {
    selectCell(clamp(cur.r + dr, 0, ROWS - 1), clamp(cur.c + dc, 0, COLS - 1));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(-1, 0); break;
      case "ArrowDown": e.preventDefault(); move(1, 0); break;
      case "ArrowLeft": e.preventDefault(); move(0, -1); break;
      case "ArrowRight": e.preventDefault(); move(0, 1); break;
      case "Delete": case "Backspace": e.preventDefault(); clearRange(); break;
      case "Enter": e.preventDefault(); startEdit(cur.r, cur.c); break;
      case "F2": e.preventDefault(); startEdit(cur.r, cur.c); break;
    }
  };

  const switchSheet = (i: number) => {
    setActiveSheet(i);
    setEditing(null);
    const pos = sel[i] ?? { r: 0, c: 0 };
    setFx(grids[i][pos.r][pos.c]);
    gridRef.current?.focus();
  };

  const loadExample = () => {
    const g = [emptyGrid(), emptyGrid()];
    // Sheet1: data dasar + ROUND
    g[0][0][0] = "10";
    g[0][1][0] = "20";
    g[0][2][0] = "30";
    g[0][3][0] = "=SUM(A1:A3)";
    g[0][0][1] = "=A1*2";
    g[0][1][1] = "=AVERAGE(A1:A3)";
    g[0][2][1] = "=A3/0";
    g[0][3][1] = "=MAX(A1:A3)";
    g[0][0][2] = "Nama";
    g[0][1][2] = "Andi";
    g[0][2][2] = "Budi";
    g[0][0][3] = "=ROUND(3.14159,2)";
    // Sheet2: referensi antar-lembar + tanggal
    g[1][0][0] = "=Sheet1!A3";
    g[1][1][0] = "=SUM(Sheet1!A1:A3)";
    g[1][2][0] = "=Sheet1!A1+Sheet1!A2";
    g[1][0][1] = "=TODAY()";
    g[1][1][1] = "=NOW()";
    setGrids(g);
    setFormats({});
    setSel({ 0: { r: 0, c: 0 }, 1: { r: 0, c: 0 } });
    setExtent({ 0: { r: 0, c: 0 }, 1: { r: 0, c: 0 } });
    setActiveSheet(0);
    setEditing(null);
    setFx(g[0][0][0]);
    setError("");
  };

  const resetGrid = () => {
    setGrids([emptyGrid(), emptyGrid()]);
    setFormats({});
    setSel({ 0: { r: 0, c: 0 }, 1: { r: 0, c: 0 } });
    setExtent({ 0: { r: 0, c: 0 }, 1: { r: 0, c: 0 } });
    setActiveSheet(0);
    setEditing(null);
    setFx("");
    setError("");
  };

  const getFormat = (r: number, c: number) => formats[`${activeSheet},${r},${c}`];

  const handleCsv = () => {
    const csv = buildCsv(grids, activeSheet, getFormat);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `spreadsheet-${SHEET_NAMES[activeSheet].toLowerCase()}.csv`);
  };

  const handlePrint = () => {
    if (printing) return;
    setError("");
    setPrinting(true);
    try {
      const html = buildSheetHtml(grids, activeSheet, getFormat);
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
            Spreadsheet dengan 2 lembar (referensi antar-lembar mis.{" "}
            <code>Sheet2!A1</code>), formula (SUM, AVERAGE, IF, ROUND, TODAY,
            NOW, …), format angka/tanggal, ekspor CSV, dan cetak.
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

        <div className="sheet-tabs" role="tablist">
          {SHEET_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={i === activeSheet}
              className={i === activeSheet ? "sheet-tab active" : "sheet-tab"}
              onClick={() => switchSheet(i)}
            >
              📄 {name}
            </button>
          ))}
        </div>

        <div className="format-row">
          <span className="format-label">
            Format {colHeader(range.c1)}{range.r1 + 1}
            {isMulti ? `:${colHeader(range.c2)}${range.r2 + 1}` : ""}:
          </span>
          <select
            className="tool-select"
            value={formats[`${activeSheet},${cur.r},${cur.c}`] ?? ""}
            onChange={(e) => applyFormat(e.target.value)}
          >
            {NUMBER_FORMATS.map((f) => (
              <option key={f.value || "general"} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div className="formula-bar">
          <span className="fx-badge">fx</span>
          <input
            value={fx}
            placeholder="Ketik nilai atau formula, mis. =SUM(A1:A3) atau =Sheet2!B1, lalu Enter"
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
          <table
            className="sheet-grid"
            onMouseMove={(e) => {
              if (!draggingRef.current) return;
              const td = (e.target as Element).closest("td");
              if (!td) return;
              const r = Number(td.getAttribute("data-r"));
              const c = Number(td.getAttribute("data-c"));
              if (Number.isFinite(r) && Number.isFinite(c)) extendTo(r, c);
            }}
          >
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
                    const inRng =
                      r >= range.r1 && r <= range.r2 &&
                      c >= range.c1 && c <= range.c2;
                    const isAnchor = cur.r === r && cur.c === c;
                    const isEdit = editing?.r === r && editing?.c === c;
                    const val = display[activeSheet][r][c];
                    const isNumber = /^-?\d/.test(val);
                    return (
                      <td
                        key={c}
                        data-r={r}
                        data-c={c}
                        className={
                          (isAnchor
                            ? "selected "
                            : inRng
                              ? "range "
                              : "") + (isNumber ? "num" : "")
                        }
                        onMouseDown={(e) => {
                          if (e.button !== 0) return;
                          e.preventDefault();
                          selectCell(r, c);
                          draggingRef.current = true;
                        }}
                        onClick={(e) => {
                          if (e.shiftKey) extendTo(r, c);
                        }}
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
          💡 Klik sel untuk memilih, <strong>seret</strong> (drag) untuk memilih
          rentang, atau <strong>Shift+klik</strong> untuk memperluas dari sel
          awal. Format di atas berlaku ke seluruh rentang terpilih; Delete /
          Backspace mengosongkan rentang. Ketik di bar formula lalu Enter, atau
          klik dua kali sel untuk mengedit langsung. Navigasi: panah, Enter, F2.
          Referensi antar-lembar: <code>Sheet2!A1</code> /{" "}
          <code>SUM(Sheet2!A1:B3)</code>. Fungsi: SUM, AVERAGE, MIN, MAX, COUNT,
          IF, CONCATENATE, LEN, ROUND, TODAY, NOW. TODAY/NOW tampil sebagai
          tanggal lewat format <em>Tanggal</em>. Error umum:{" "}
          <code>#DIV/0!</code> (bagi nol), <code>#ERROR!</code> (sintaks /
          siklus, termasuk lintas lembar).
        </p>
      </section>
    </div>
  );
}
