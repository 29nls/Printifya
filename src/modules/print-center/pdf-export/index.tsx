import { useRef, useState } from "react";
import { jsPDF } from "jspdf";
import {
  exportPasFotoPdf,
  fitsA4,
  maxCols,
  maxRows,
  MIN_MARGIN_CM,
  orientedDims,
  printPasFotoPdf,
  type SheetOrientation,
} from "../../photo-studio/shared/exportPdf";
import { getPaper, PAPER_SIZES, type PaperSize } from "../../photo-studio/shared/paperSize";
import { printHtmlSheet } from "../printer-lokal/printHtml";
import "../../photo-studio/shared/style.css";
import "./style.css";

/** Preset ukuran pas foto untuk mode foto (subset Photo Studio). */
const PHOTO_PRESETS = [
  { id: "2x3", label: "2 × 3 cm", widthMm: 20, heightMm: 30, fileName: "pas-foto-2x3" },
  { id: "3x4", label: "3 × 4 cm", widthMm: 30, heightMm: 40, fileName: "pas-foto-3x4" },
  { id: "4x6", label: "4 × 6 cm", widthMm: 40, heightMm: 60, fileName: "pas-foto-4x6" },
] as const;

type Mode = "foto" | "dokumen";

const MARGIN_CM = 0.5;

function clampInt(raw: string, min: number, max: number): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Teks → PDF native (selectable) dengan kertas/margin/orientasi pilihan. */
function buildTextPdf(
  title: string,
  body: string,
  paper: PaperSize,
  orientation: SheetOrientation,
  marginCm: number
): jsPDF {
  const d = orientedDims(paper, orientation);
  const margin = marginCm * 10;
  const doc = new jsPDF({
    unit: "mm",
    format: [d.widthMm, d.heightMm],
    orientation,
  });
  const contentW = d.widthMm - margin * 2;
  let y = margin;

  const ensure = (needed: number) => {
    if (y + needed > d.heightMm - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("times", "bold");
  doc.setFontSize(18);
  ensure(12);
  doc.text(title || "Dokumen", margin, y);
  y += 10;
  doc.setLineWidth(0.4);
  doc.line(margin, y, d.widthMm - margin, y);
  y += 8;

  doc.setFont("times", "normal");
  doc.setFontSize(12);
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const lines = paras.length > 0 ? paras : ["(dokumen kosong)"];
  for (const para of lines) {
    const wrapped = doc.splitTextToSize(para, contentW);
    ensure(wrapped.length * 6 + 4);
    doc.text(wrapped, margin, y);
    y += wrapped.length * 6 + 3;
  }
  return doc;
}

export default function PdfExportPage() {
  const [mode, setMode] = useState<Mode>("foto");
  const [paper, setPaper] = useState<PaperSize>(() => getPaper("a4"));
  const [marginCm, setMarginCm] = useState(MARGIN_CM);
  const [orientation, setOrientation] = useState<SheetOrientation>("portrait");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Mode foto
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>("3x4");
  const [cols, setCols] = useState(6);
  const [rows, setRows] = useState(7);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mode dokumen
  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");

  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);

  const preset = PHOTO_PRESETS.find((p) => p.id === presetId) ?? PHOTO_PRESETS[1];
  const size = {
    id: preset.id,
    title: preset.label,
    label: preset.label,
    description: "",
    icon: "🪪",
    widthPx: Math.round(preset.widthMm * 300 / 25.4),
    heightPx: Math.round(preset.heightMm * 300 / 25.4),
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    dpi: 300,
    fileName: preset.fileName,
  };

  const canFoto = photoUrl !== null;
  const fotoFits = canFoto && fitsA4(size, cols, rows, marginCm, paper, orientation);
  const maxC = Math.max(maxCols(size, MIN_MARGIN_CM, paper), maxCols(size, MIN_MARGIN_CM, paper, "landscape"));
  const maxR = Math.max(maxRows(size, MIN_MARGIN_CM, paper), maxRows(size, MIN_MARGIN_CM, paper, "landscape"));

  const onFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    // Grid default sesuai ukuran & kertas saat ini.
    setCols(maxCols(size, MARGIN_CM, paper, orientation));
    setRows(maxRows(size, MARGIN_CM, paper, orientation));
  };

  const exportPdf = async () => {
    if (busy || printing) return;
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "foto") {
        if (!photoUrl) throw new Error("Upload foto dulu.");
        if (!fotoFits) throw new Error(`Grid ${cols}×${rows} tidak muat di ${paper.name}.`);
        await exportPasFotoPdf(size, photoUrl, {
          cols,
          rows,
          marginCm,
          paper,
          orientation,
        });
        setInfo(`PDF ${paper.name} (${orientation}) siap diunduh.`);
      } else {
        const doc = buildTextPdf(docTitle, docBody, paper, orientation, marginCm);
        doc.save(`dokumen-${paper.id}-${orientation}.pdf`);
        setInfo(`PDF dokumen ${paper.name} (${orientation}) siap diunduh.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setBusy(false);
    }
  };

  const printPdf = async () => {
    if (busy || printing) return;
    setError("");
    setInfo("");
    setPrinting(true);
    try {
      if (mode === "foto") {
        if (!photoUrl) throw new Error("Upload foto dulu.");
        if (!fotoFits) throw new Error(`Grid ${cols}×${rows} tidak muat di ${paper.name}.`);
        const ok = await printPasFotoPdf(size, photoUrl, {
          cols,
          rows,
          marginCm,
          paper,
          orientation,
        });
        if (!ok) setError("Popup diblokir browser. Izinkan pop-up untuk membuka dialog cetak.");
      } else {
        // Jalur HTML (iframe print) — kertas & orientasi mengikuti pengaturan.
        const esc = (s: string) =>
          s.replace(/[<>&"]/g, (ch) =>
            ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : "&quot;"
          );
        const d = orientedDims(paper, orientation);
        const paras = docBody.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        const html = `<!doctype html><html lang="id"><head><meta charset="utf-8" /><title>${esc(docTitle || "Dokumen")}</title><style>
@page { size: ${d.widthMm}mm ${d.heightMm}mm; margin: ${marginCm * 10}mm; }
* { box-sizing: border-box; }
body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.6; color: #111; margin: 0; }
h1 { font-size: 18pt; border-bottom: 2px solid #333; padding-bottom: 6pt; }
p { margin: 0 0 8pt; text-align: justify; }
</style></head><body><h1>${esc(docTitle || "Dokumen")}</h1>${paras.length ? paras.map((p) => `<p>${esc(p)}</p>`).join("\n") : "<p>(dokumen kosong)</p>"}</body></html>`;
        const ok = printHtmlSheet(html);
        if (!ok) setError("Tidak bisa membuat iframe cetak di browser ini.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="pdf-export-page">
      <header className="module-header">
        <span className="module-icon">📦</span>
        <div>
          <h1>PDF Export</h1>
          <p>
            Ekspor foto (template pas foto) atau dokumen teks menjadi PDF siap
            cetak — pilih kertas, margin, dan orientasi, lalu unduh atau kirim
            ke printer.
          </p>
        </div>
      </header>

      <div className="pdfx-layout">
        <section className="panel">
          <div className="mode-tabs">
            <button
              type="button"
              className={`btn ${mode === "foto" ? "btn-primary" : ""}`}
              onClick={() => { setMode("foto"); setError(""); }}
            >
              🖼️ Foto → PDF
            </button>
            <button
              type="button"
              className={`btn ${mode === "dokumen" ? "btn-primary" : ""}`}
              onClick={() => { setMode("dokumen"); setError(""); }}
            >
              📄 Dokumen → PDF
            </button>
          </div>

          {mode === "foto" ? (
            <>
              <h2>Foto → Template PDF</h2>
              <div className="form-field">
                <span>Foto sumber</span>
                <div className="logo-row">
                  {photoUrl ? (
                    <>
                      <img src={photoUrl} alt="Foto" className="logo-thumb" />
                      <button type="button" className="btn" onClick={() => { setPhotoUrl(null); setError(""); }}>
                        ✕ Ganti
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                      📤 Upload Foto
                    </button>
                  )}
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </div>
              </div>

              <label className="form-field">
                <span>Ukuran pas foto per sel</span>
                <select
                  className="tool-select"
                  value={presetId}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  {PHOTO_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <div className="sheet-settings">
                <label>
                  Kolom
                  <input
                    type="number"
                    min={1}
                    max={maxC}
                    value={cols}
                    onChange={(e) => setCols(clampInt(e.target.value, 1, maxC))}
                  />
                </label>
                <label>
                  Baris
                  <input
                    type="number"
                    min={1}
                    max={maxR}
                    value={rows}
                    onChange={(e) => setRows(clampInt(e.target.value, 1, maxR))}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <h2>Dokumen → PDF</h2>
              <label className="form-field">
                <span>Judul</span>
                <input
                  type="text"
                  value={docTitle}
                  placeholder="Judul dokumen"
                  onChange={(e) => setDocTitle(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Isi <em>(paragraf dipisah baris kosong)</em></span>
                <textarea
                  rows={10}
                  value={docBody}
                  placeholder="Tulis isi dokumen di sini…"
                  onChange={(e) => setDocBody(e.target.value)}
                />
              </label>
            </>
          )}
        </section>

        <section className="panel">
          <h2>Pengaturan Halaman</h2>
          <label className="form-field">
            <span>Kertas</span>
            <select
              className="tool-select"
              value={paper.id}
              onChange={(e) => {
                const p = getPaper(e.target.value);
                setPaper(p);
                setCols(maxCols(size, MARGIN_CM, p, orientation));
                setRows(maxRows(size, MARGIN_CM, p, orientation));
              }}
            >
              {PAPER_SIZES.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Margin (cm)</span>
            <input
              type="number"
              min={0.2}
              max={1.5}
              step={0.1}
              value={marginCm}
              onChange={(e) => setMarginCm(Math.min(1.5, Math.max(0.2, Number(e.target.value) || 0.2)))}
            />
          </label>
          <label className="form-field">
            <span>Orientasi</span>
            <select
              className="tool-select"
              value={orientation}
              onChange={(e) => setOrientation(e.target.value as SheetOrientation)}
            >
              <option value="portrait">Potret</option>
              <option value="landscape">Lanskap</option>
            </select>
          </label>

          {mode === "foto" && !fotoFits && (
            <p className="error">
              Grid {cols}×{rows} tidak muat di {paper.name} ({orientation}) dengan margin {marginCm} cm.
            </p>
          )}

          <div className="pdfx-actions">
            <button type="button" className="btn btn-primary" disabled={busy || printing || (mode === "foto" && !fotoFits)} onClick={exportPdf}>
              {busy ? "Menyiapkan…" : "⬇️ Ekspor PDF"}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy || printing || (mode === "foto" && !fotoFits)} onClick={printPdf}>
              {printing ? "Menyiapkan…" : "🖨️ Cetak"}
            </button>
          </div>

          {error && <p className="error">{error}</p>}
          {info && <p className="archive-info">{info}</p>}
          <p className="hint">
            💡 Nama file PDF: foto → <code>{size.fileName}-{paper.id}.pdf</code>;
            dokumen → <code>dokumen-{paper.id}-{orientation}.pdf</code>. Cetak foto memakai
            PDF + dialog browser (autoPrint); cetak dokumen memakai iframe HTML.
          </p>
        </section>
      </div>
    </div>
  );
}
