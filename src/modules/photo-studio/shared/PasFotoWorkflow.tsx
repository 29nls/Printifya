import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import {
  setPendingLayoutPhoto,
  setPendingLayoutPhotos,
} from "../../shared/autoLayoutBridge";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import {
  clearStoredSizeId,
  readStoredSizeId,
  writeStoredSizeId,
} from "./sizeStorage";
import type { PasFotoSize } from "./pasFotoSize";
import CropperEditor from "./CropperEditor";
import A4SheetPreview from "./A4SheetPreview";
import {
  exportLayoutPdf,
  exportPasFotoPdf,
  fitsA4,
  maxCols,
  maxRows,
  printLayoutPdf,
  printPasFotoPdf,
} from "./exportPdf";
import "./style.css";

type Step = "upload" | "edit" | "result";

interface PasFotoWorkflowProps {
  /** Ukuran pas foto aktif (awal). Wajib diisi; bila `presets` ada, diinisialisasi dari preset pertama. */
  size: PasFotoSize;
  /** Daftar preset ukuran (mode visa). Saat ada, tampil pemilih preset di atas halaman. */
  presets?: PasFotoSize[];
  /** Header modul. Default: diambil dari ukuran aktif. */
  header?: { title: string; description: string; icon: string };
  /** Sembunyikan header (dipakai modul yang merender header sendiri, mis. Custom Size). */
  showHeader?: boolean;
  /** Gambar awal (data URL) yang langsung masuk ke langkah crop, mis. hasil modul lain. */
  initialImage?: string;
  /**
   * Bila diisi, preset aktif (selectSize) dipersist ke localStorage dan muncul
   * tombol "Setel Ulang Preferensi" di pemilih preset (mis. negara visa).
   */
  sizeStorageKey?: string;
}

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

const LABEL_SIZES = [
  { value: "small", label: "Kecil", pt: 5, previewPx: 6 },
  { value: "medium", label: "Sedang", pt: 7, previewPx: 8 },
  { value: "large", label: "Besar", pt: 9, previewPx: 10 },
] as const;

type LabelSizeValue = (typeof LABEL_SIZES)[number]["value"];

/** Alur lengkap pas foto: upload → crop → hasil + template cetak A4 + ekspor PDF. */
export default function PasFotoWorkflow({
  size,
  presets,
  header,
  showHeader = true,
  initialImage,
  sizeStorageKey,
}: PasFotoWorkflowProps) {
  const DEFAULT_MARGIN_CM = 0.5;

  // Preset aktif: pulihkan dari localStorage bila sizeStorageKey diisi.
  const [activeSize, setActiveSize] = useState<PasFotoSize>(() => {
    if (sizeStorageKey && presets && presets.length > 0) {
      const savedId = readStoredSizeId(sizeStorageKey);
      if (savedId) {
        const found = presets.find((p) => p.id === savedId);
        if (found) return found;
      }
    }
    return size;
  });

  // Persist preset aktif (mis. negara visa) setiap berubah.
  useEffect(() => {
    if (sizeStorageKey) writeStoredSizeId(sizeStorageKey, activeSize.id);
  }, [activeSize, sizeStorageKey]);
  // Batas input (maks di margin minimal) vs default grid (maks di margin default).
  const maxC = maxCols(activeSize);
  const maxR = maxRows(activeSize);

  const [step, setStep] = useState<Step>(initialImage ? "edit" : "upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(
    initialImage ?? null
  );
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  // Mode "beberapa orang": hasil crop yang sudah disimpan, diisi ke lembar A4.
  const [people, setPeople] = useState<{ url: string; name: string }[]>([]);
  const [showLabels, setShowLabels] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSizeValue>("medium");
  // Saat diisi, crop berikutnya menggantikan orang ke-index itu (bukan menambah).
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  // Ulangi foto bila jumlah orang kurang dari jumlah sel (halaman tunggal).
  const [repeatFill, setRepeatFill] = useState(true);
  const [page, setPage] = useState(0);
  const [fileName, setFileName] = useState(
    initialImage ? "gambar-import.png" : ""
  );
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [cols, setCols] = useState(maxCols(activeSize, DEFAULT_MARGIN_CM));
  const [rows, setRows] = useState(maxRows(activeSize, DEFAULT_MARGIN_CM));
  const [marginCm, setMarginCm] = useState(DEFAULT_MARGIN_CM);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const canExport = fitsA4(activeSize, cols, rows, marginCm);
  const count = cols * rows;
  const multiPage = people.length > count;
  const totalPages = Math.max(1, Math.ceil(people.length / count));

  // Foto untuk halaman aktif pada pratinjau: per orang bila multi-halaman;
  // diulang bila pengguna mengaktifkan opsi ulang (halaman tunggal).
  const pageItems =
    multiPage || !repeatFill || people.length === 0
      ? people.slice(page * count, page * count + count)
      : Array.from({ length: count }, (_, i) => people[i % people.length]);
  const pageSrcs = pageItems.map((p) => p.url);
  const pageLabels = pageItems.map((p) => p.name);
  // Array untuk ekspor/cetak: diulang penuh (halaman tunggal + opsi ulang),
  // atau semua orang apa adanya (multi-halaman otomatis di exportLayoutPdf).
  const fillItems =
    people.length > 0 && people.length <= count && repeatFill
      ? Array.from({ length: count }, (_, i) => people[i % people.length])
      : people;
  const fillSrcs = fillItems.map((p) => p.url);
  const fillLabels = fillItems.map((p) => p.name);
  const labelSizeDef =
    LABEL_SIZES.find((s) => s.value === labelSize) ?? LABEL_SIZES[1];

  const headerInfo =
    header ?? {
      title: activeSize.title,
      description: activeSize.description,
      icon: activeSize.icon,
    };

  // Sinkronkan ukuran aktif bila prop `size` berubah (mode ukuran kustom).
  // Foto yang sudah dicrop tidak valid lagi, jadi ulangi crop foto asli.
  // Hanya sinkron saat id prop BENAR-BENAR berubah (bukan mount pertama /
  // double-mount StrictMode) agar preset yang dipulihkan dari storage (visa)
  // tidak ditimpa oleh prop `size` (preset pertama).
  const prevSizeId = useRef(size.id);
  useEffect(() => {
    if (prevSizeId.current === size.id) return;
    prevSizeId.current = size.id;
    if (size.id === activeSize.id) return;
    setActiveSize(size);
    setCroppedUrl(null);
    setPeople([]);
    setReplaceIndex(null);
    setPage(0);
    setCols(maxCols(size, DEFAULT_MARGIN_CM));
    setRows(maxRows(size, DEFAULT_MARGIN_CM));
    setError("");
    setStep(originalUrl ? "edit" : "upload");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Jaga halaman aktif valid bila jumlah orang / grid berubah.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages - 1));
  }, [totalPages]);

  // Bersihkan object URL lama saat diganti / komponen dilepas.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    setFileName(file.name);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setStep("edit");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** Ganti preset ukuran: hasil crop lama tidak valid lagi, jadi ulangi crop foto asli. */
  const selectSize = (s: PasFotoSize) => {
    if (s.id === activeSize.id) return;
    setActiveSize(s);
    setCroppedUrl(null);
    setPeople([]);
    setReplaceIndex(null);
    setPage(0);
    setCols(maxCols(s, DEFAULT_MARGIN_CM));
    setRows(maxRows(s, DEFAULT_MARGIN_CM));
    setError("");
    setStep(originalUrl ? "edit" : "upload");
  };

  /** Reset preset tersimpan ke yang pertama; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    if (!sizeStorageKey) return;
    clearStoredSizeId(sizeStorageKey);
    if (presets && presets.length > 0) selectSize(presets[0]);
  };

  /** Hapus satu orang dari daftar; yang tampil menjadi orang terakhir yang tersisa. */
  const removePerson = (i: number) => {
    const next = people.filter((_, idx) => idx !== i);
    setPeople(next);
    if (next.length === 0) {
      setCroppedUrl(null);
      setStep("upload");
    } else if (i === people.length - 1) {
      // Orang yang dihapus adalah yang sedang tampil → tampilkan yang baru terakhir.
      setCroppedUrl(next[next.length - 1].url);
    }
    setReplaceIndex(null);
    setPage(0);
  };

  /** Perbarui nama/keterangan satu orang. */
  const updateName = (i: number, name: string) => {
    setPeople((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, name } : p))
    );
  };

  /** Commit hasil crop: ganti orang terakhir (Edit Ulang / Foto Lain) atau tambah orang baru. */
  const applyCrop = (url: string) => {
    // Nama default dari nama file (tanpa ekstensi), bisa diedit di strip.
    const name = fileName.replace(/\.[^.]+$/, "") || `Orang ${people.length + 1}`;
    setPeople((prev) => {
      const next = [...prev];
      if (replaceIndex !== null && replaceIndex < next.length) {
        next[replaceIndex] = { url, name };
      } else {
        next.push({ url, name });
      }
      return next;
    });
    setCroppedUrl(url);
    setReplaceIndex(null);
    setStep("result");
  };

  const download = () => {
    if (!croppedUrl) return;
    const a = document.createElement("a");
    a.href = croppedUrl;
    a.download = `${activeSize.fileName}.png`;
    a.click();
  };

  /** Teruskan hasil (data URL) ke alur crop Pas Foto 3x4 via bridge antar modul. */
  const forwardTo3x4 = () => {
    if (!croppedUrl) return;
    setPendingPasFoto(croppedUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  /**
   * Kirim ke Auto Layout: satu orang → satu foto; beberapa orang → seluruh
   * daftar sekaligus (nama tiap orang ikut sebagai label lembar).
   */
  const forwardToLayout = () => {
    if (!croppedUrl) return;
    if (people.length > 1) {
      setPendingLayoutPhotos(
        people.map((p) => ({ url: p.url, name: p.name }))
      );
    } else {
      setPendingLayoutPhoto(croppedUrl, people[0]?.name ?? activeSize.title);
    }
    navigate("/ai-assistant/auto-layout");
  };

  const handleExportPdf = async () => {
    if (!croppedUrl || !canExport || exporting) return;
    setError("");
    setExporting(true);
    try {
      if (people.length <= 1) {
        await exportPasFotoPdf(activeSize, croppedUrl, { cols, rows, marginCm });
      } else {
        await exportLayoutPdf(activeSize, fillSrcs, {
          cols,
          rows,
          marginCm,
          labels: showLabels ? fillLabels : undefined,
          labelSizePt: showLabels ? labelSizeDef.pt : undefined,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = async () => {
    if (!croppedUrl || !canExport || printing) return;
    setError("");
    setPrinting(true);
    try {
      const allowed =
        people.length <= 1
          ? await printPasFotoPdf(activeSize, croppedUrl, {
              cols,
              rows,
              marginCm,
            })
          : await printLayoutPdf(activeSize, fillSrcs, {
              cols,
              rows,
              marginCm,
              labels: showLabels ? fillLabels : undefined,
              labelSizePt: showLabels ? labelSizeDef.pt : undefined,
            });
      if (!allowed) {
        setError(
          "Popup diblokir browser. Izinkan pop-up untuk membuka dialog cetak."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="pas-foto-page">
      {showHeader && (
        <header className="module-header">
          <span className="module-icon">{headerInfo.icon}</span>
          <div>
            <h1>{headerInfo.title}</h1>
            <p>{headerInfo.description}</p>
          </div>
        </header>
      )}

      {presets && presets.length > 0 && (
        <div className="preset-picker">
          <span className="preset-label">Pilih negara / jenis visa</span>
          <div className="preset-chips">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.id === activeSize.id ? "chip active" : "chip"}
                onClick={() => selectSize(p)}
              >
                {p.title}
              </button>
            ))}
          </div>
          {sizeStorageKey && (
            <div className="preset-reset">
              <ResetPreferencesButton
                title="Hapus preset ukuran tersimpan modul ini"
                onReset={handleResetPrefs}
              />
            </div>
          )}
          {activeSize.note && <p className="preset-note">ℹ️ {activeSize.note}</p>}
        </div>
      )}

      {step === "upload" && (
        <section className="panel upload-section">
          {people.length > 0 && (
            <div className="people-summary">
              <span>
                👥 <strong>{people.length}</strong> orang sudah dicrop dan
                tersimpan di lembar A4.
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setReplaceIndex(null);
                  setStep("result");
                }}
              >
                ⬅️ Lihat Hasil
              </button>
            </div>
          )}
          <div
            className={dragOver ? "upload-zone dragging" : "upload-zone"}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <div className="upload-icon">📤</div>
            <h3>Seret & letakkan foto di sini</h3>
            <p>atau klik untuk memilih file — JPG, PNG, atau WebP</p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {error && <p className="error">{error}</p>}

          <p className="hint">
            💡 Hasil akhir:{" "}
            <strong>
              {activeSize.widthPx} × {activeSize.heightPx} px @{" "}
              {activeSize.dpi ?? 300} DPI
            </strong>{" "}
            — ukuran cetak {activeSize.label}, siap cetak di printer biasa.{" "}
            {people.length > 0
              ? "Upload foto orang berikutnya untuk ditambahkan ke lembar."
              : "Setelah crop, foto bisa ditambahkan ke lembar bersama orang lain (mode beberapa orang)."}
          </p>
        </section>
      )}

      {step === "edit" && originalUrl && (
        <CropperEditor
          key={originalUrl}
          size={activeSize}
          src={originalUrl}
          fileName={fileName}
          onCancel={() => setStep("upload")}
          onApply={applyCrop}
        />
      )}

      {step === "result" && croppedUrl && (
        <div className="result">
          <div className="result-layout">
            <div className="result-preview">
              <div className="print-frame">
                <img
                  src={croppedUrl}
                  alt={`Hasil ${activeSize.title}`}
                  className="print-size"
                  style={{
                    width: `${activeSize.widthMm / 10}cm`,
                    height: `${activeSize.heightMm / 10}cm`,
                  }}
                />
              </div>
              <p className="caption">Ukuran cetak sebenarnya ({activeSize.label})</p>
            </div>

            <div className="result-info">
              <h2>
                Hasil Pas Foto
                {people.length > 1 && (
                  <span className="people-count"> · {people.length} orang</span>
                )}
              </h2>
              <ul className="info-list">
                <li>
                  <span>Jenis</span>
                  <strong>{activeSize.title}</strong>
                </li>
                <li>
                  <span>Ukuran cetak</span>
                  <strong>{activeSize.label}</strong>
                </li>
                <li>
                  <span>Resolusi</span>
                  <strong>
                    {activeSize.widthPx} × {activeSize.heightPx} px
                  </strong>
                </li>
                <li>
                  <span>DPI</span>
                  <strong>{activeSize.dpi ?? 300}</strong>
                </li>
                <li>
                  <span>Format</span>
                  <strong>PNG (transparan)</strong>
                </li>
              </ul>

              <div className="result-actions">
                <button type="button" className="btn btn-primary" onClick={download}>
                  ⬇️ Unduh PNG
                </button>
                {activeSize.id !== "3x4" && (
                  <button
                    type="button"
                    className="btn"
                    title="Bawa foto ini langsung ke alur crop Pas Foto 3x4"
                    onClick={forwardTo3x4}
                  >
                    🪪 Jadikan Pas Foto 3x4
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  title={
                    people.length > 1
                      ? `Kirim ${people.length} orang sekaligus ke Auto Layout`
                      : "Kirim foto ini ke Auto Layout"
                  }
                  onClick={forwardToLayout}
                >
                  🧩 Susun ke Lembar A4
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setStep("upload")}>
                  ➕ Crop Orang Lain
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setReplaceIndex(people.length - 1);
                    setStep("edit");
                  }}
                >
                  ✏️ Edit Ulang
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setReplaceIndex(people.length - 1);
                    setStep("upload");
                  }}
                >
                  🔄 Foto Lain
                </button>
              </div>

              {people.length > 1 && (
                <div className="people-strip">
                  {people.map((p, i) => (
                    <div className="people-item" key={i}>
                      <img src={p.url} alt={p.name} title={p.name} />
                      <input
                        className="people-name-input"
                        value={p.name}
                        placeholder="Nama / keterangan"
                        title="Nama / keterangan untuk sel ini"
                        onChange={(e) => updateName(i, e.target.value)}
                      />
                      <button
                        type="button"
                        className="remove-person"
                        title="Hapus dari lembar"
                        onClick={() => removePerson(i)}
                      >
                        ✕
                      </button>
                      <span className="people-index">{i + 1}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <section className="panel sheet-section">
            <div className="sheet-head">
              <h2>Pratinjau Template Cetak A4</h2>
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
                  onChange={(e) => setMarginCm(clampNum(e.target.value, 0.2, 1.5))}
                />
              </label>
              {people.length > 1 && !multiPage && (
                <label className="repeat-toggle">
                  <input
                    type="checkbox"
                    checked={repeatFill}
                    onChange={(e) => setRepeatFill(e.target.checked)}
                  />
                  Ulangi bila foto kurang dari sel
                </label>
              )}
              {people.length > 1 && (
                <label className="repeat-toggle">
                  <input
                    type="checkbox"
                    checked={showLabels}
                    onChange={(e) => setShowLabels(e.target.checked)}
                  />
                  Tampilkan nama di lembar
                </label>
              )}
              {showLabels && people.length > 1 && (
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
                {printing ? "Menyiapkan PDF…" : "🖨️ Cetak"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canExport || exporting || printing}
                onClick={handleExportPdf}
              >
                {exporting ? "Menyiapkan PDF…" : "⬇️ Ekspor PDF A4"}
              </button>
            </div>

            {error && <p className="error">{error}</p>}

            {!canExport && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman A4 dengan margin {marginCm} cm.
                Kurangi kolom/baris atau perbesar margin.
              </p>
            )}

            <A4SheetPreview
              size={activeSize}
              src={people.length <= 1 ? croppedUrl : undefined}
              srcs={people.length > 1 ? pageSrcs : undefined}
              cols={cols}
              rows={rows}
              marginCm={marginCm}
              labels={people.length > 1 && showLabels ? pageLabels : undefined}
              labelSizePx={
                people.length > 1 && showLabels ? labelSizeDef.previewPx : undefined
              }
            />
          </section>
        </div>
      )}
    </div>
  );
}
