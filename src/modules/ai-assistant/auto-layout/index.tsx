import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";
import A4SheetPreview from "../../photo-studio/shared/A4SheetPreview";
import {
  exportLayoutPdf,
  fitsA4,
  maxCols,
  maxRows,
} from "../../photo-studio/shared/exportPdf";
import {
  buildHtmlSheet,
  printHtmlSheet,
} from "../../print-center/printer-lokal/printHtml";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import {
  clearPendingLayoutPhotos,
  peekPendingLayoutPhotos,
} from "../../shared/autoLayoutBridge";
import "../../photo-studio/shared/style.css";
import "./style.css";

const PRESETS: PasFotoSize[] = [
  {
    id: "2x3",
    title: "Pas Foto 2x3",
    label: "2 × 3 cm",
    description: "Template 2×3 cm.",
    icon: "🪪",
    widthPx: 236,
    heightPx: 354,
    widthMm: 20,
    heightMm: 30,
    fileName: "auto-layout-2x3",
  },
  {
    id: "3x4",
    title: "Pas Foto 3x4",
    label: "3 × 4 cm",
    description: "Template 3×4 cm.",
    icon: "🪪",
    widthPx: 354,
    heightPx: 472,
    widthMm: 30,
    heightMm: 40,
    fileName: "auto-layout-3x4",
  },
  {
    id: "4x6",
    title: "Pas Foto 4x6",
    label: "4 × 6 cm",
    description: "Template 4×6 cm.",
    icon: "🪪",
    widthPx: 472,
    heightPx: 709,
    widthMm: 40,
    heightMm: 60,
    fileName: "auto-layout-4x6",
  },
];

const DEFAULT_MARGIN_CM = 0.5;

const LABEL_SIZES = [
  { value: "small", label: "Kecil", pt: 5, previewPx: 6 },
  { value: "medium", label: "Sedang", pt: 7, previewPx: 8 },
  { value: "large", label: "Besar", pt: 9, previewPx: 10 },
] as const;

type LabelSizeValue = (typeof LABEL_SIZES)[number]["value"];

const clampInt = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const clampNum = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
};

interface PhotoItem {
  url: string;
  name: string;
}

export default function AutoLayoutPage() {
  const [size, setSize] = useState<PasFotoSize>(PRESETS[1]);
  // Bila datang dari modul lain (mis. Auto Crop Face / Background Removal /
  // pas foto beberapa orang), langsung masukkan foto-foto tersebut ke daftar.
  // peek (bukan take) agar aman terhadap double-mount React StrictMode;
  // dikosongkan setelah commit di bawah — pola sama dengan pasFotoBridge.
  const [photos, setPhotos] = useState<PhotoItem[]>(() => {
    const pending = peekPendingLayoutPhotos();
    return pending ? pending.map((p) => ({ url: p.url, name: p.name })) : [];
  });

  useEffect(() => {
    clearPendingLayoutPhotos();
  }, []);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cols, setCols] = useState(maxCols(PRESETS[1], DEFAULT_MARGIN_CM));
  const [rows, setRows] = useState(maxRows(PRESETS[1], DEFAULT_MARGIN_CM));
  const [marginCm, setMarginCm] = useState(DEFAULT_MARGIN_CM);
  const [page, setPage] = useState(0);
  const [showLabels, setShowLabels] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSizeValue>("medium");
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const navigate = useNavigate();

  const maxC = maxCols(size);
  const maxR = maxRows(size);
  const count = cols * rows;
  const canExport = photos.length > 0 && fitsA4(size, cols, rows, marginCm);
  const multiPage = photos.length > count;
  const totalPages = Math.max(1, Math.ceil(photos.length / count));

  // Bersihkan semua object URL saat komponen dilepas.
  useEffect(() => {
    return () => {
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  // Jaga halaman aktif tetap valid bila grid/ukuran berubah.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);

  /** Foto untuk halaman aktif: halaman penuh diisi berurutan; bila foto kurang dari sel, diulang. */
  const pageItems = multiPage
    ? photos.slice(page * count, page * count + count)
    : Array.from(
        { length: count },
        (_, i) => photos[i % photos.length]
      ).filter(Boolean);
  const pageSrcs = pageItems.map((p) => p.url);
  const pageLabels = pageItems.map((p) => p.name);

  const labelSizeDef =
    LABEL_SIZES.find((s) => s.value === labelSize) ?? LABEL_SIZES[1];

  const handleFiles = (files?: FileList | null) => {
    setError("");
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (list.some((f) => !f.type.startsWith("image/"))) {
      setError("Semua file harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    const items = list.map((f) => ({
      url: URL.createObjectURL(f),
      // Nama default = nama file tanpa ekstensi, bisa diedit pengguna.
      name: f.name.replace(/\.[^.]+$/, ""),
    }));
    urlsRef.current.push(...items.map((i) => i.url));
    setPhotos((prev) => [...prev, ...items]);
    setPage(0);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const selectSize = (s: PasFotoSize) => {
    setSize(s);
    setCols(maxCols(s, DEFAULT_MARGIN_CM));
    setRows(maxRows(s, DEFAULT_MARGIN_CM));
    setError("");
  };

  const resetPhotos = () => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
    setPhotos([]);
    setPage(0);
    setError("");
  };

  const updateName = (i: number, name: string) => {
    setPhotos((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, name } : p))
    );
  };

  /** Blob URL → data URL mandiri (tahan terhadap revoke object URL). */
  const toDataUrl = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas 2D tidak tersedia."));
          return;
        }
        ctx.drawImage(image, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("Gagal memuat foto."));
      image.src = url;
    });

  /** Teruskan foto terpilih ke alur Pas Foto 3x4. */
  const forwardPhoto = async (photo: PhotoItem) => {
    setError("");
    try {
      const dataUrl = await toDataUrl(photo.url);
      setPendingPasFoto(dataUrl);
      navigate("/photo-studio/pas-foto-3x4");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal meneruskan foto.");
    }
  };

  const handleExport = async () => {
    if (!canExport || exporting || printing) return;
    setError("");
    setExporting(true);
    try {
      await exportLayoutPdf(size, photos.map((p) => p.url), {
        cols,
        rows,
        marginCm,
        labels: showLabels ? photos.map((p) => p.name) : undefined,
        labelSizePt: showLabels ? labelSizeDef.pt : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setExporting(false);
    }
  };

  /**
   * Cetak lewat iframe print HTML (tanpa jsPDF). Mode banyak foto: satu
   * halaman berisi foto berurutan; bila melebihi satu halaman, dibuat
   * halaman tambahan di dokumen cetak.
   */
  const handlePrint = () => {
    if (!canExport || exporting || printing) return;
    setError("");
    setPrinting(true);
    try {
      // Satu gambar per sel (berurutan); mode siklus memakai isian halaman ini.
      const items = multiPage ? photos : pageItems;
      const srcs = items.map((p) => p.url);
      const html = buildHtmlSheet(srcs, size, {
        cols,
        rows,
        marginCm,
        labels: showLabels ? items.map((p) => p.name) : undefined,
        labelSizePt: showLabels ? labelSizeDef.pt : undefined,
      });
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

  return (
    <div className="auto-layout-page">
      <header className="module-header">
        <span className="module-icon">🧩</span>
        <div>
          <h1>Auto Layout</h1>
          <p>
            Susun banyak foto otomatis ke template A4 — foto diisi sel per sel;
            bila melebihi satu halaman, halaman tambahan dibuat otomatis.
          </p>
        </div>
      </header>

      <section className="panel">
        {photos.length === 0 ? (
          <>
            <div
              className={dragOver ? "upload-zone dragging" : "upload-zone"}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <div className="upload-icon">📤</div>
              <h3>Seret & letakkan banyak foto di sini</h3>
              <p>atau klik untuk memilih beberapa file sekaligus</p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <p className="hint">
              💡 Foto diisi otomatis ke sel template dari kiri ke kanan, atas ke
              bawah. Jika foto lebih sedikit dari sel, urutan diulang; jika
              lebih banyak, dibuat halaman baru.
            </p>
          </>
        ) : (
          <>
            <div className="file-row">
              <span>
                🖼️ <strong>{photos.length}</strong> foto diupload
              </span>
              <div className="file-row-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => inputRef.current?.click()}
                >
                  ➕ Tambah Foto
                </button>
                <button type="button" className="btn" onClick={resetPhotos}>
                  🔄 Reset
                </button>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="photo-strip">
              {photos.map((p, i) => (
                <div className="photo-item" key={i}>
                  <img src={p.url} alt={p.name} title={p.name} />
                  <input
                    className="photo-label-input"
                    value={p.name}
                    placeholder="Nama / keterangan"
                    title="Nama / keterangan untuk sel ini"
                    onChange={(e) => updateName(i, e.target.value)}
                  />
                  <button
                    type="button"
                    className="photo-forward"
                    title="Jadikan Pas Foto 3x4"
                    onClick={() => forwardPhoto(p)}
                  >
                    🪪
                  </button>
                </div>
              ))}
            </div>
            <p className="hint">
              💡 Ketik nama/keterangan di bawah tiap foto (label muncul di
              lembar bila diaktifkan). Klik 🪪 pada thumbnail untuk meneruskan
              foto itu langsung ke alur crop Pas Foto 3x4.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {photos.length > 0 && (
        <>
          <section className="panel">
            <span className="preset-label">Ukuran foto per sel</span>
            <div className="preset-chips">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === size.id ? "chip active" : "chip"}
                  onClick={() => selectSize(p)}
                >
                  {p.title}
                </button>
              ))}
            </div>

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
              <label>
                Margin (cm)
                <input
                  type="number"
                  min={0.2}
                  max={1.5}
                  step={0.1}
                  value={marginCm}
                  onChange={(e) =>
                    setMarginCm(clampNum(e.target.value, 0.2, 1.5))
                  }
                />
              </label>
              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                Tampilkan nama di lembar
              </label>
              {showLabels && (
                <label>
                  Ukuran label
                  <select
                    className="tool-select"
                    value={labelSize}
                    onChange={(e) =>
                      setLabelSize(e.target.value as LabelSizeValue)
                    }
                  >
                    {LABEL_SIZES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canExport || exporting || printing}
                onClick={handlePrint}
              >
                {printing ? "Menyiapkan…" : "🖨️ Cetak"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canExport || exporting || printing}
                onClick={handleExport}
              >
                {exporting ? "Menyiapkan PDF…" : "⬇️ Ekspor PDF A4"}
              </button>
            </div>

            {!canExport && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman A4 dengan margin{" "}
                {marginCm} cm. Kurangi kolom/baris atau perbesar margin.
              </p>
            )}
          </section>

          <section className="panel sheet-section">
            <div className="sheet-head">
              <h2>Pratinjau Template A4</h2>
              {multiPage && (
                <div className="page-nav">
                  <button
                    type="button"
                    className="btn"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    ◀
                  </button>
                  <span>
                    Halaman {page + 1} dari {totalPages}
                  </span>
                  <button
                    type="button"
                    className="btn"
                    disabled={page >= totalPages - 1}
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                  >
                    ▶
                  </button>
                </div>
              )}
            </div>
            <A4SheetPreview
              size={size}
              srcs={pageSrcs}
              cols={cols}
              rows={rows}
              marginCm={marginCm}
              labels={showLabels ? pageLabels : undefined}
              labelSizePx={showLabels ? labelSizeDef.previewPx : undefined}
            />
          </section>
        </>
      )}
    </div>
  );
}
