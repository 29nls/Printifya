import { useEffect, useRef, useState } from "react";
import { printHtmlSheet } from "../../print-center/printer-lokal/printHtml";
import { recordPrint } from "../../print-history/printHistoryStorage";
import { downloadUrl } from "../../shared/downloadUrl";
import { loadString, saveString } from "../../shared/prefsStorage";
import { buildDocHtml } from "./docHtml";
import { buildDocxBlob } from "./docxExport";
import { buildTableHtml } from "./tableOps";
import { buildImageHtml, fitImageDimensions, IMAGE_JPEG_QUALITY, type ImageAlignment } from "./imageOps";
import {
  getPaper,
  PAPER_SIZES,
  type PaperSize,
} from "../../photo-studio/shared/paperSize";
import "../../photo-studio/shared/style.css";
import "./style.css";

const PAPER_KEY = "printifya.word-editor.paper";

function loadPaperId(): string | null {
  return loadString(PAPER_KEY, null);
}

function savePaperId(id: string): void {
  saveString(PAPER_KEY, id);
}

const HEADINGS = [
  { value: "p", label: "Paragraf" },
  { value: "h1", label: "Judul 1" },
  { value: "h2", label: "Judul 2" },
  { value: "h3", label: "Judul 3" },
];

const FONT_SIZES = [
  { value: "3", label: "Normal" },
  { value: "1", label: "Kecil" },
  { value: "2", label: "Agak kecil" },
  { value: "4", label: "Agak besar" },
  { value: "5", label: "Besar" },
  { value: "6", label: "Sangat besar" },
  { value: "7", label: "Raksasa" },
];

interface ToolButton {
  id: string;
  label: string;
  title: string;
  cmd: string;
  bold?: boolean;
}

const BUTTONS: ToolButton[] = [
  { id: "bold", label: "B", title: "Tebal (Ctrl+B)", cmd: "bold", bold: true },
  { id: "italic", label: "I", title: "Miring (Ctrl+I)", cmd: "italic", bold: true },
  { id: "underline", label: "U", title: "Garis bawah (Ctrl+U)", cmd: "underline", bold: true },
  { id: "strike", label: "S", title: "Coret", cmd: "strikeThrough", bold: true },
  { id: "ul", label: "•≡", title: "Daftar bullet", cmd: "insertUnorderedList" },
  { id: "ol", label: "1≡", title: "Daftar nomor", cmd: "insertOrderedList" },
  { id: "left", label: "⯇", title: "Rata kiri", cmd: "justifyLeft" },
  { id: "center", label: "☰", title: "Rata tengah", cmd: "justifyCenter" },
  { id: "right", label: "⯈", title: "Rata kanan", cmd: "justifyRight" },
];

export default function WordEditorPage() {
  const editorRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("Dokumen Tanpa Judul");
  const [stats, setStats] = useState({ words: 0, chars: 0 });
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [paper, setPaper] = useState<PaperSize>(() =>
    getPaper(loadPaperId() ?? undefined)
  );
  const [showTableModal, setShowTableModal] = useState(false);
  const [tableRows, setTableRows] = useState(3);
  const [tableCols, setTableCols] = useState(3);
  const [tableHasHeader, setTableHasHeader] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [pendingImageSrc, setPendingImageSrc] = useState<string | null>(null);
  const [imageAlignment, setImageAlignment] = useState<ImageAlignment>("center");
  const [imageCaption, setImageCaption] = useState("");
  const [imageMaxWidth, setImageMaxWidth] = useState(80);

  // Persist ukuran kertas terpilih.
  useEffect(() => savePaperId(paper.id), [paper]);

  const updateStats = () => {
    const text = editorRef.current?.innerText ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    setStats({ words, chars: text.length });
  };

  /** Jalankan perintah format pada pilihan teks saat ini. */
  const exec = (cmd: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
    updateStats();
  };

  /** Sisipkan tabel interaktif pada posisi kursor */
  const insertTable = () => {
    const tableHtml = buildTableHtml({
      rows: tableRows,
      cols: tableCols,
      hasHeader: tableHasHeader,
    });
    exec("insertHTML", tableHtml);
    setShowTableModal(false);
  };

  /** Pilih file gambar lokal */
  const handleSelectImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Berkas yang dipilih harus berupa gambar.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const { width, height } = fitImageDimensions(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);
          setPendingImageSrc(compressed);
          setShowImageModal(true);
        } else {
          setPendingImageSrc(src);
          setShowImageModal(true);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  /** Sisipkan gambar yang telah dikompresi ke dokumen */
  const insertImage = () => {
    if (!pendingImageSrc) return;
    const imgHtml = buildImageHtml({
      src: pendingImageSrc,
      alignment: imageAlignment,
      caption: imageCaption.trim() || undefined,
      maxWidthPercent: imageMaxWidth,
    });
    exec("insertHTML", imgHtml);
    setShowImageModal(false);
    setPendingImageSrc(null);
    setImageCaption("");
  };

  /** Pantau status aktif (tebal/miring/dll) saat pilihan berubah. */
  useEffect(() => {
    const onSelection = () => {
      const d = document;
      setActive({
        bold: d.queryCommandState("bold"),
        italic: d.queryCommandState("italic"),
        underline: d.queryCommandState("underline"),
        strike: d.queryCommandState("strikeThrough"),
        ul: d.queryCommandState("insertUnorderedList"),
        ol: d.queryCommandState("insertOrderedList"),
      });
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  const handlePrint = () => {
    if (printing) return;
    setError("");
    setPrinting(true);
    try {
      const content = editorRef.current?.innerHTML ?? "";
      const html = buildDocHtml(title, content, paper);
      const ok = printHtmlSheet(html);
      if (!ok) {
        setError("Tidak bisa membuat iframe cetak di browser ini.");
      }
      // HTML disertakan supaya entri ini bisa dicetak ulang persis: dokumen
      // Word sendiri tidak dipersist, jadi ini satu-satunya salinan isinya.
      recordPrint({
        name: title || "Dokumen",
        paperSize: paper.name,
        ok,
        html,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
      recordPrint({ name: title || "Dokumen", paperSize: paper.name, ok: false });
    } finally {
      setPrinting(false);
    }
  };

  const resetDoc = () => {
    if (editorRef.current) editorRef.current.innerHTML = "";
    setTitle("Dokumen Tanpa Judul");
    setError("");
    updateStats();
    editorRef.current?.focus();
  };

  /** Ekspor dokumen ke berkas .docx client-side */
  const handleExportDocx = () => {
    try {
      const content = editorRef.current?.innerHTML ?? "";
      const blob = buildDocxBlob(title, content);
      const url = URL.createObjectURL(blob);
      const filename = `${(title || "dokumen").toLowerCase().replace(/[^a-z0-9_-]/gi, "-")}.docx`;
      downloadUrl(url, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengekspor file DOCX.");
    }
  };

  return (
    <div className="word-editor-page">
      <header className="module-header">
        <span className="module-icon">📝</span>
        <div>
          <h1>Word Editor</h1>
          <p>
            Editor teks kaya WYSIWYG — format langsung, lalu cetak atau simpan
            sebagai PDF lewat dialog cetak browser (pola HTML, tanpa jsPDF).
          </p>
        </div>
      </header>

      <section className="panel word-toolbar-panel">
        <div className="word-title-row">
          <input
            type="text"
            className="word-title-input"
            value={title}
            placeholder="Judul dokumen"
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="word-actions">
            <label className="paper-field">
              <span>Kertas</span>
              <select
                className="tool-select"
                value={paper.id}
                onChange={(e) => setPaper(getPaper(e.target.value))}
              >
                {PAPER_SIZES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={printing}
              onClick={handlePrint}
            >
              {printing ? "Menyiapkan…" : "🖨️ Cetak / Simpan PDF"}
            </button>
            <button
              type="button"
              className="btn"
              title="Unduh dokumen dalam format Microsoft Word (.docx)"
              onClick={handleExportDocx}
            >
              📄 Unduh .DOCX
            </button>
            <button type="button" className="btn" onClick={resetDoc}>
              🗑️ Kosongkan
            </button>
          </div>
        </div>

        <div className="word-toolbar" role="toolbar" aria-label="Format teks">
          <button
            type="button"
            className="btn tool-btn"
            title="Urungkan"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec("undo")}
          >
            ↩
          </button>
          <button
            type="button"
            className="btn tool-btn"
            title="Ulangi"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec("redo")}
          >
            ↪
          </button>

          <span className="toolbar-sep" />

          {BUTTONS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={
                active[b.id] ? "btn tool-btn active" : "btn tool-btn"
              }
              title={b.title}
              aria-label={b.title}
              aria-pressed={active[b.id] ?? false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => exec(b.cmd)}
            >
              {b.label}
            </button>
          ))}

          <span className="toolbar-sep" />

          <select
            className="tool-select"
            title="Gaya paragraf"
            onChange={(e) => exec("formatBlock", e.target.value)}
            defaultValue="p"
          >
            {HEADINGS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </select>

          <select
            className="tool-select"
            title="Ukuran huruf"
            onChange={(e) => exec("fontSize", e.target.value)}
            defaultValue="3"
          >
            {FONT_SIZES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          <span className="toolbar-sep" />

          <button
            type="button"
            className="btn tool-btn"
            title="Sisip Tabel"
            onClick={() => setShowTableModal(true)}
          >
            📊 +Tabel
          </button>

          <button
            type="button"
            className="btn tool-btn"
            title="Sisip Gambar / Watermark"
            onClick={() => fileInputRef.current?.click()}
          >
            🖼️ +Gambar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleSelectImageFile}
          />
        </div>
      </section>

      {showTableModal && (
        <div className="table-modal-backdrop" onClick={() => setShowTableModal(false)}>
          <div className="table-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Sisipkan Tabel</h3>
            <div className="table-modal-body">
              <label>
                Jumlah Baris:
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={tableRows}
                  onChange={(e) => setTableRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </label>
              <label>
                Jumlah Kolom:
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={tableCols}
                  onChange={(e) => setTableCols(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={tableHasHeader}
                  onChange={(e) => setTableHasHeader(e.target.checked)}
                />
                Gunakan Baris Header
              </label>
            </div>
            <div className="table-modal-actions">
              <button type="button" className="btn btn-primary" onClick={insertTable}>
                Sisipkan
              </button>
              <button type="button" className="btn" onClick={() => setShowTableModal(false)}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {showImageModal && pendingImageSrc && (
        <div className="table-modal-backdrop" onClick={() => setShowImageModal(false)}>
          <div className="table-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Atur & Sisipkan Gambar</h3>
            <div className="table-modal-body">
              <div style={{ textAlign: "center", marginBottom: 8 }}>
                <img
                  src={pendingImageSrc}
                  alt="Preview"
                  style={{ maxHeight: 120, maxWidth: "100%", borderRadius: 4 }}
                />
              </div>
              <label>
                Perataan:
                <select
                  value={imageAlignment}
                  onChange={(e) => setImageAlignment(e.target.value as ImageAlignment)}
                  style={{ padding: "4px 8px", borderRadius: 4 }}
                >
                  <option value="center">Rata Tengah</option>
                  <option value="left">Rata Kiri</option>
                  <option value="right">Rata Kanan</option>
                </select>
              </label>
              <label>
                Lebar Maksimal:
                <input
                  type="number"
                  min="10"
                  max="100"
                  value={imageMaxWidth}
                  onChange={(e) => setImageMaxWidth(Math.max(10, Math.min(100, parseInt(e.target.value, 10) || 80)))}
                />
                %
              </label>
              <label style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                Keterangan / Caption:
                <input
                  type="text"
                  placeholder="Keterangan opsional"
                  value={imageCaption}
                  onChange={(e) => setImageCaption(e.target.value)}
                  style={{ width: "100%", padding: "4px 8px", borderRadius: 4 }}
                />
              </label>
            </div>
            <div className="table-modal-actions">
              <button type="button" className="btn btn-primary" onClick={insertImage}>
                Sisipkan
              </button>
              <button type="button" className="btn" onClick={() => setShowImageModal(false)}>
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="panel word-editor-panel">
        <div
          ref={editorRef}
          className="editor-page"
          style={{
            minHeight: Math.round(
              680 * (paper.heightMm / paper.widthMm) * (210 / 297)
            ),
          }}
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Mulai menulis di sini…"
          onInput={updateStats}
        />
        {error && <p className="error">{error}</p>}
        <p className="hint word-stats">
          {stats.words} kata · {stats.chars} karakter — siap cetak {paper.name}.
          Konten berupa HTML; format yang tidak didukung tetap dipertahankan
          sebagai teks.
        </p>
      </section>
    </div>
  );
}
