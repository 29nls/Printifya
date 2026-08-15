import { useRef, useState } from "react";
import "../../photo-studio/shared/style.css";
import "./style.css";

interface PdfDoc {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  blob: Blob;
  url: string;
  source: "upload" | "hasil";
}

interface OpResult {
  ok: boolean;
  error?: string;
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function parseRange(raw: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, Number(m[1]));
      const b = Math.min(max, Number(m[2]));
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    } else if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n >= 1 && n <= max) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

export default function PdfEditorPage() {
  const [docs, setDocs] = useState<PdfDoc[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState("");
  const [deletePages, setDeletePages] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = docs.find((d) => d.id === selectedId) ?? null;

  const addDocs = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    setBusy(true);
    const next: PdfDoc[] = [];
    for (const f of Array.from(files)) {
      if (!/pdf$/i.test(f.name) && f.type !== "application/pdf") {
        setError(`"${f.name}" bukan PDF — dilewati.`);
        continue;
      }
      try {
        const pageCount = await countPages(f);
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          size: f.size,
          pageCount,
          blob: f,
          url: URL.createObjectURL(f),
          source: "upload",
        });
      } catch (e) {
        setError(`Gagal membaca "${f.name}": ${e instanceof Error ? e.message : e}`);
      }
    }
    if (next.length > 0) {
      setDocs((prev) => [...prev, ...next]);
      setSelectedId(next[0].id);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  async function countPages(file: File): Promise<number> {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    return pdf.getPageCount();
  }

  const loadLib = async () => {
    const { PDFDocument } = await import("pdf-lib");
    return PDFDocument;
  };

  const addResult = (name: string, bytes: Uint8Array, sourceBlob?: Blob) => {
    // bytes.slice() → Uint8Array ber-ArrayBuffer segar (kompatibel BlobPart).
    const blob = sourceBlob ?? new Blob([bytes.slice()], { type: "application/pdf" });
    const doc: PdfDoc = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      size: blob.size,
      pageCount: 0,
      blob,
      url: URL.createObjectURL(blob),
      source: "hasil",
    };
    // Hitung jumlah halaman hasil untuk tampilan daftar (tidak memblokir UI).
    void (async () => {
      try {
        const PDFDocument = await loadLib();
        const pdf = await PDFDocument.load(await blob.arrayBuffer(), {
          ignoreEncryption: true,
        });
        setDocs((prev) =>
          prev.map((d) =>
            d.id === doc.id ? { ...d, pageCount: pdf.getPageCount() } : d
          )
        );
      } catch {
        /* abaikan */
      }
    })();
    setDocs((prev) => [...prev, doc]);
    setSelectedId(doc.id);
    return doc;
  };

  const run = async (fn: () => Promise<OpResult>) => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Operasi gagal.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operasi gagal.");
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = () =>
    run(async () => {
      if (docs.length < 2) return { ok: false, error: "Butuh minimal 2 dokumen untuk digabung." };
      const PDFDocument = await loadLib();
      const out = await PDFDocument.create();
      for (const d of docs) {
        const src = await PDFDocument.load(await d.blob.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const base = docs.map((d) => d.name.replace(/\.pdf$/i, "")).join("-").slice(0, 60);
      addResult(`${base || "gabungan"}-merged.pdf`, bytes);
      return { ok: true };
    });

  const handleSplit = () =>
    run(async () => {
      if (!selected) return { ok: false, error: "Pilih dokumen dulu." };
      const pages = parseRange(range, selected.pageCount);
      if (pages.length === 0)
        return { ok: false, error: "Rentang tidak valid. Contoh: 1-3 atau 1,3,5." };
      const PDFDocument = await loadLib();
      const src = await PDFDocument.load(await selected.blob.arrayBuffer(), { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const copy = await out.copyPages(src, pages.map((p) => p - 1));
      copy.forEach((p) => out.addPage(p));
      const bytes = await out.save();
      addResult(`${selected.name.replace(/\.pdf$/i, "")}-pages-${pages.join("-")}.pdf`, bytes);
      return { ok: true };
    });

  const handleRotate = () =>
    run(async () => {
      if (!selected) return { ok: false, error: "Pilih dokumen dulu." };
      const { PDFDocument, degrees } = await import("pdf-lib");
      const src = await PDFDocument.load(await selected.blob.arrayBuffer(), { ignoreEncryption: true });
      src.getPages().forEach((page) => {
        page.setRotation(degrees((page.getRotation().angle + 90) % 360));
      });
      const bytes = await src.save();
      addResult(`${selected.name.replace(/\.pdf$/i, "")}-rotated.pdf`, bytes);
      return { ok: true };
    });

  const handleDelete = () =>
    run(async () => {
      if (!selected) return { ok: false, error: "Pilih dokumen dulu." };
      const pages = parseRange(deletePages, selected.pageCount);
      if (pages.length === 0)
        return { ok: false, error: "Halaman tidak valid. Contoh: 2,4 atau 3-5." };
      const PDFDocument = await loadLib();
      const src = await PDFDocument.load(await selected.blob.arrayBuffer(), { ignoreEncryption: true });
      // Hapus dari belakang agar indeks tetap valid.
      [...pages].sort((a, b) => b - a).forEach((p) => src.removePage(p - 1));
      if (src.getPageCount() === 0)
        return { ok: false, error: "Semua halaman terhapus — tidak diizinkan." };
      const bytes = await src.save();
      addResult(`${selected.name.replace(/\.pdf$/i, "")}-deleted.pdf`, bytes);
      return { ok: true };
    });

  const removeDoc = (id: string) => {
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    URL.revokeObjectURL(d.url);
    const next = docs.filter((x) => x.id !== id);
    setDocs(next);
    if (selectedId === id) setSelectedId(next[next.length - 1]?.id ?? null);
  };

  const download = () => {
    if (!selected) return;
    const a = document.createElement("a");
    a.href = selected.url;
    a.download = selected.name;
    a.click();
  };

  return (
    <div className="pdfe-page">
      <header className="module-header">
        <span className="module-icon">📄</span>
        <div>
          <h1>PDF Editor</h1>
          <p>
            Lihat, gabung, pisah, putar, dan hapus halaman PDF — langsung di
            browser (pdf-lib, tanpa server). Pratinjau memakai penampil PDF
            bawaan browser.
          </p>
        </div>
      </header>

      <div className="pdfe-layout">
        <section className="panel">
          <h2>Dokumen</h2>
          <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            📤 Upload PDF (bisa banyak)
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(e) => addDocs(e.target.files)}
          />

          {docs.length === 0 ? (
            <p className="hint">
              Belum ada dokumen. Upload satu atau beberapa PDF untuk mulai
              mengedit.
            </p>
          ) : (
            <ul className="pdfe-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`pdfe-item ${selectedId === d.id ? "active" : ""}`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <strong>{d.name}</strong>
                    <span>
                      {d.pageCount} hal · {fmtSize(d.size)}
                      {d.source === "hasil" ? " · ✨ hasil" : ""}
                    </span>
                  </button>
                  <button type="button" className="btn np-del" title="Hapus dari daftar" onClick={() => removeDoc(d.id)}>
                    🗑
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Pratinjau</h2>
          {selected ? (
            <>
              <div className="pdfe-preview">
                <iframe title={selected.name} src={selected.url} />
              </div>
              <div className="pdfe-actions">
                <button type="button" className="btn btn-primary" onClick={download}>
                  ⬇️ Unduh
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => window.open(selected.url, "_blank")}
                >
                  🔗 Buka di Tab Baru
                </button>
              </div>
            </>
          ) : (
            <p className="hint">Pilih dokumen untuk melihat pratinjau.</p>
          )}
        </section>

        <section className="panel">
          <h2>Operasi</h2>

          <div className="pdfe-op">
            <strong>🔗 Gabungkan Semua</strong>
            <p className="hint">Gabung semua dokumen di daftar menjadi satu PDF.</p>
            <button type="button" className="btn btn-primary" onClick={handleMerge} disabled={busy || docs.length < 2}>
              {busy ? "Memproses…" : "Gabung"}
            </button>
          </div>

          <div className="pdfe-op">
            <strong>✂️ Pisah Rentang Halaman</strong>
            <p className="hint">
              Salin halaman terpilih (mis. <code>1-3</code> atau <code>1,3,5</code>) dari{" "}
              {selected ? selected.name : "(pilih dokumen)"}.
            </p>
            <div className="pdfe-op-row">
              <input
                type="text"
                value={range}
                placeholder="mis. 1-3"
                onChange={(e) => setRange(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={handleSplit} disabled={busy || !selected}>
                Pisah
              </button>
            </div>
          </div>

          <div className="pdfe-op">
            <strong>🔄 Putar 90°</strong>
            <p className="hint">Putar semua halaman dokumen terpilih searah jarum jam.</p>
            <button type="button" className="btn btn-primary" onClick={handleRotate} disabled={busy || !selected}>
              Putar
            </button>
          </div>

          <div className="pdfe-op">
            <strong>🗑️ Hapus Halaman</strong>
            <p className="hint">
              Hapus halaman tertentu (mis. <code>2,4</code> atau <code>3-5</code>) dari{" "}
              {selected ? selected.name : "(pilih dokumen)"}.
            </p>
            <div className="pdfe-op-row">
              <input
                type="text"
                value={deletePages}
                placeholder="mis. 2,4"
                onChange={(e) => setDeletePages(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={handleDelete} disabled={busy || !selected}>
                Hapus
              </button>
            </div>
          </div>

          {error && <p className="error">{error}</p>}
          <p className="hint">
            💡 Setiap operasi menghasilkan dokumen baru (✨ hasil) yang langsung
            tampil di daftar &amp; pratinjau — dokumen asli tidak berubah.
            Unduh hasil untuk menyimpannya sebagai file.
          </p>
        </section>
      </div>
    </div>
  );
}
