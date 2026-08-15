import { useEffect, useRef, useState } from "react";
import { printHtmlSheet } from "../../print-center/printer-lokal/printHtml";
import { buildDocHtml } from "./docHtml";
import "../../photo-studio/shared/style.css";
import "./style.css";

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
      const html = buildDocHtml(title, content);
      const ok = printHtmlSheet(html);
      if (!ok) {
        setError("Tidak bisa membuat iframe cetak di browser ini.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
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
            <button
              type="button"
              className="btn btn-primary"
              disabled={printing}
              onClick={handlePrint}
            >
              {printing ? "Menyiapkan…" : "🖨️ Cetak / Simpan PDF"}
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
        </div>
      </section>

      <section className="panel word-editor-panel">
        <div
          ref={editorRef}
          className="editor-page"
          contentEditable
          suppressContentEditableWarning
          data-placeholder="Mulai menulis di sini…"
          onInput={updateStats}
        />
        {error && <p className="error">{error}</p>}
        <p className="hint word-stats">
          {stats.words} kata · {stats.chars} karakter — siap cetak A4. Konten
          berupa HTML; format yang tidak didukung tetap dipertahankan sebagai
          teks.
        </p>
      </section>
    </div>
  );
}
