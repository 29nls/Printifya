import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";
import A4SheetPreview from "../../photo-studio/shared/A4SheetPreview";
import FramePicker from "../../photo-studio/shared/FramePicker";
import { getFrame } from "../../photo-studio/shared/frames";
import {
  createFrameWorkerPool,
  frameAll,
  terminateFrameWorkerPool,
} from "./frameWorker";
import {
  chooseOrientation,
  exportLayoutPdf,
  fitsA4,
  maxCols,
  maxRows,
  MIN_MARGIN_CM,
} from "../../photo-studio/shared/exportPdf";
import {
  getPaper,
  PAPER_SIZES,
  type PaperSize,
} from "../../photo-studio/shared/paperSize";
import {
  buildHtmlSheet,
  printHtmlSheet,
} from "../../print-center/printer-lokal/printHtml";
import { blobToDataUrl } from "../../shared/downloadUrl";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import {
  clearPendingLayoutPhotos,
  peekPendingLayoutPhotos,
} from "../../shared/autoLayoutBridge";
import {
  clearLayoutSettings,
  loadLayoutSettings,
  saveLayoutSettings,
} from "./settingsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
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
  /**
   * Teks Booth khusus foto ini (strip hashtag / banner) — kosong atau
   * undefined = pakai teks default event (boothHashtag / boothBanner).
   * Berlaku untuk semua sel yang memuat foto ini.
   */
  boothText?: string;
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
  // Pengaturan kertas, grid & label — default dari localStorage, di-clamp ke
  // preset aktif & kertas aktif (batas maks kolom/baris berbeda per ukuran).
  const [saved] = useState(() => loadLayoutSettings());
  const [paper, setPaper] = useState<PaperSize>(() => getPaper(saved?.paperId));
  // Margin yang DIMUAT (di-clamp ke [0.2, 1.5]). Batas grid saat load dihitung
  // dari margin INI — bukan MIN_MARGIN_CM — sehingga config valid yang disimpan
  // pada margin kecil tidak reload sebagai "Grid X×Y tidak muat" pada margin
  // tersimpan yang lebih besar (ekspor terblokir sampai disesuaikan manual).
  const initMargin = clampNum(
    String(saved?.marginCm ?? DEFAULT_MARGIN_CM),
    0.2,
    1.5
  );
  const [marginCm, setMarginCm] = useState(initMargin);
  // Grid tersimpan dipertahankan HANYA bila pasangan (cols, rows) benar-benar
  // muat di SALAH SATU orientasi pada margin tersimpan (potret ATAU lanskap —
  // orientasi otomatis memilih yang muat). Bila tidak (data versi lama, atau
  // margin tersimpan mengubah muat), clamp ke batas POTRET — pasangan
  // (maxCols, maxRows) potret dijamin muat karena cek lebar/tinggi independen,
  // jadi tidak ada peringatan "tidak muat" palsu saat reload.
  const roundSavedC = Math.max(
    1,
    Math.round(saved?.cols ?? maxCols(PRESETS[1], DEFAULT_MARGIN_CM, paper))
  );
  const roundSavedR = Math.max(
    1,
    Math.round(saved?.rows ?? maxRows(PRESETS[1], DEFAULT_MARGIN_CM, paper))
  );
  const savedGridFits =
    fitsA4(PRESETS[1], roundSavedC, roundSavedR, initMargin, paper, "portrait") ||
    fitsA4(PRESETS[1], roundSavedC, roundSavedR, initMargin, paper, "landscape");
  const portraitMaxC = maxCols(PRESETS[1], initMargin, paper);
  const portraitMaxR = maxRows(PRESETS[1], initMargin, paper);
  const [cols, setCols] = useState(() =>
    savedGridFits ? roundSavedC : Math.min(roundSavedC, portraitMaxC)
  );
  const [rows, setRows] = useState(() =>
    savedGridFits ? roundSavedR : Math.min(roundSavedR, portraitMaxR)
  );
  const [page, setPage] = useState(0);
  const [showLabels, setShowLabels] = useState(saved?.showLabels ?? false);
  const [labelSize, setLabelSize] = useState<LabelSizeValue>(
    (saved?.labelSize as LabelSizeValue) ?? "medium"
  );
  // Drag untuk mengurutkan ulang strip foto (indeks sumber & target).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  // Bingkai photobox — default dari localStorage, "" = tanpa bingkai.
  // Bila id tersimpan tidak lagi cocok dengan katalog (mis. data versi lama),
  // fallback ke "Tanpa bingkai" agar pemilih tidak kosong & framing tidak
  // diam-diam gagal; efek persistensi di bawah ikut menimpa nilai basi itu.
  const [frameId, setFrameId] = useState(() => {
    const stored = saved?.frameId ?? "";
    return stored && getFrame(stored) ? stored : "";
  });
  const frame = getFrame(frameId);
  // Bingkai Booth bertulisan (hashtag / banner) — saat aktif, tiap foto di
  // strip bisa diberi teks sendiri (mis. nama tamu) lewat input per foto.
  const boothTextFrameActive =
    frame?.id === "booth-hashtag" ||
    frame?.id === "booth-hashtag-warna" ||
    frame?.id === "booth-banner";
  // Garis potong (sekat) antar sel — default AKTIF agar mudah dipotong.
  const [cutLines, setCutLines] = useState(saved?.cutLines ?? true);
  // Teks kustom bingkai Booth (hashtag & banner) — tersimpan per sesi, dipakai
  // sebagai teks bingkai bertulisan; kosongkan untuk kembali ke default.
  const [boothHashtag, setBoothHashtag] = useState(
    saved?.boothHashtag ?? "#SENYUM"
  );
  const [boothBanner, setBoothBanner] = useState(
    saved?.boothBanner ?? "PHOTO BOOTH"
  );
  // Versi ter-debounce untuk reframe: mengetik tidak memicu ulang framing
  // seluruh batch tiap karakter (reframe hanya setelah jeda 300 ms).
  const [debouncedHashtag, setDebouncedHashtag] = useState(boothHashtag);
  const [debouncedBanner, setDebouncedBanner] = useState(boothBanner);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHashtag(boothHashtag), 300);
    return () => clearTimeout(t);
  }, [boothHashtag]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBanner(boothBanner), 300);
    return () => clearTimeout(t);
  }, [boothBanner]);
  // Versi ber-bingkai tiap foto (kunci = URL asli). Dihitung ulang saat
  // daftar foto / bingkai / ukuran sel berubah.
  const [framedMap, setFramedMap] = useState<Record<string, string>>({});
  // Metadata pengaturan yang dipakai membangun framedMap — dipakai
  // ensureFreshFrames untuk mendeteksi teks/bingkai basi sebelum ekspor/cetak.
  const framedMetaRef = useRef<{
    frameId: string;
    hashtag: string;
    banner: string;
    signature: string;
    texts: string;
  } | null>(null);
  // Signature SET URL foto (urut-bebas): efek bingkai hanya dipicu saat foto
  // ditambah/dihapus — mengedit label atau meng-drag urutan tidak menambah
  // foto, jadi tidak perlu mem-frame ulang semuanya.
  const photosSignature = [...new Set(photos.map((p) => p.url))]
    .sort()
    .join("\u0000");
  // Signature teks Booth per foto (urutan penting — teks milik foto tertentu).
  const rawTextsSig = photos.map((p) => p.boothText ?? "").join("\u0000");
  // Versi ter-debounce: mengetik teks per foto tidak memicu ulang framing
  // seluruh batch tiap karakter (reframe hanya setelah jeda 300 ms).
  const [debouncedTextsSig, setDebouncedTextsSig] = useState(rawTextsSig);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTextsSig(rawTextsSig), 300);
    return () => clearTimeout(t);
  }, [rawTextsSig]);

  // Persist pengaturan kertas, grid, label, bingkai & teks Booth setiap berubah.
  useEffect(() => {
    saveLayoutSettings({
      cols,
      rows,
      marginCm,
      paperId: paper.id,
      showLabels,
      labelSize,
      frameId,
      cutLines,
      boothHashtag,
      boothBanner,
    });
  }, [
    cols,
    rows,
    marginCm,
    paper,
    showLabels,
    labelSize,
    frameId,
    cutLines,
    boothHashtag,
    boothBanner,
  ]);

  // Terapkan bingkai ke semua foto (blob URL → data URL ber-bingkai) — batch
  // framing lewat `frameAll` (jalur worker + fallback thread utama), sumber
  // tunggal yang sama dengan ekspor/cetak.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!frame) {
        setFramedMap({});
        framedMetaRef.current = null;
        return;
      }
      const result = await frameAll(
        frameClients,
        photos,
        frame,
        size.widthPx,
        size.heightPx,
        { hashtagText: debouncedHashtag, bannerText: debouncedBanner },
        () => cancelled,
        useFrameWorker
      );
      if (!cancelled) {
        setFramedMap(result);
        framedMetaRef.current = {
          frameId: frame.id,
          hashtag: debouncedHashtag,
          banner: debouncedBanner,
          signature: photosSignature,
          texts: debouncedTextsSig,
        };
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [
    frame,
    photosSignature,
    size.id,
    debouncedHashtag,
    debouncedBanner,
    debouncedTextsSig,
  ]);
  // Framing batch (foto + bingkai + encode PNG) dijalankan di Web Worker
  // (pool kecil, satu Blob sumber per permintaan — decode/draw/encode di
  // worker) agar UI tidak membeku pada batch besar — fallback thread utama
  // bila tanpa Worker/createImageBitmap.
  const useFrameWorker =
    typeof Worker !== "undefined" && typeof createImageBitmap === "function";
  const frameClients = useMemo(
    () => (useFrameWorker ? createFrameWorkerPool() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // Hentikan semua worker pool saat modul dilepas: tolak permintaan tertunda,
  // terminate (bitmap yang dipegang worker ikut dibebaskan).
  useEffect(() => {
    return () => terminateFrameWorkerPool(frameClients);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  const navigate = useNavigate();

  const maxC = Math.max(
    maxCols(size, MIN_MARGIN_CM, paper),
    maxCols(size, MIN_MARGIN_CM, paper, "landscape")
  );
  const maxR = Math.max(
    maxRows(size, MIN_MARGIN_CM, paper),
    maxRows(size, MIN_MARGIN_CM, paper, "landscape")
  );
  const count = cols * rows;
  // Orientasi lembar: otomatis lanskap bila grid hanya muat bila lembar diputar.
  const orientation = chooseOrientation(size, cols, rows, marginCm, paper);
  const canExport =
    photos.length > 0 &&
    fitsA4(size, cols, rows, marginCm, paper, orientation);
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

  /** URL ber-bingkai untuk satu foto (fallback ke asli bila belum siap). */
  const framedOf = (url: string) => framedMap[url] ?? url;

  /** Foto untuk halaman aktif: halaman penuh diisi berurutan; bila foto kurang dari sel, diulang. */
  const pageItems = multiPage
    ? photos.slice(page * count, page * count + count)
    : Array.from(
        { length: count },
        (_, i) => photos[i % photos.length]
      ).filter(Boolean);
  const pageSrcs = pageItems.map((p) => framedOf(p.url));
  const pageLabels = pageItems.map((p) => p.name);

  const labelSizeDef =
    LABEL_SIZES.find((s) => s.value === labelSize) ?? LABEL_SIZES[1];

  /**
   * Drag antar sel di pratinjau: pindahkan foto dari sel `from` ke sel `to`
   * pada halaman aktif. Mode banyak-halaman memetakan sel ke indeks foto
   * absolut (page*count + i); mode ulang (foto < sel) memetakan lewat siklus
   * `i % photos.length`. Mengubah urutan `photos` — pratinjau, label, PDF,
   * dan cetak semuanya mengikuti urutan baru.
   */
  const reorderPhoto = (from: number, to: number) => {
    if (from === to || photos.length === 0) return;
    const absFrom = multiPage ? page * count + from : from % photos.length;
    const absTo = multiPage ? page * count + to : to % photos.length;
    setPhotos((prev) => {
      if (absFrom >= prev.length || absFrom === absTo) return prev;
      const next = [...prev];
      const [moved] = next.splice(absFrom, 1);
      next.splice(absTo, 0, moved);
      return next;
    });
  };

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
    setCols(maxCols(s, DEFAULT_MARGIN_CM, paper));
    setRows(maxRows(s, DEFAULT_MARGIN_CM, paper));
    setError("");
  };

  /** Ganti ukuran kertas: grid disesuaikan agar muat di lembar baru. */
  const selectPaper = (id: string) => {
    const p = getPaper(id);
    setPaper(p);
    setCols(maxCols(size, DEFAULT_MARGIN_CM, p));
    setRows(maxRows(size, DEFAULT_MARGIN_CM, p));
    setPage(0);
    setError("");
  };

  /** Ganti margin: arah sebaliknya dari clamp-load — margin dinaikkan dan
   *  grid tidak muat lagi di orientasi pilihan → cols/rows diturunkan otomatis
   *  (konsisten dengan selectPaper/setSize yang mereset grid). */
  const handleMarginChange = (raw: string) => {
    const m = clampNum(raw, 0.2, 1.5);
    setMarginCm(m);
    const o = chooseOrientation(size, cols, rows, m, paper);
    if (!fitsA4(size, cols, rows, m, paper, o)) {
      setCols(maxCols(size, m, paper, o));
      setRows(maxRows(size, m, paper, o));
    }
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

  /** Teks Booth khusus satu foto (hashtag/banner); kosong = default event. */
  const updateBoothText = (i: number, text: string) => {
    setPhotos((prev) =>
      prev.map((p, idx) => (idx === i ? { ...p, boothText: text } : p))
    );
  };

  /** Pindahkan foto dari indeks `from` ke `to` di strip (drag thumbnail). */
  const movePhoto = (from: number, to: number) => {
    if (from === to) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  /** Teruskan foto terpilih ke alur Pas Foto 3x4 — blob/data URL → data URL
   *  mandiri via `blobToDataUrl` bersama (fetch bekerja untuk keduanya dan
   *  menjaga byte asli, tanpa re-encode canvas). */
  const forwardPhoto = async (photo: PhotoItem) => {
    setError("");
    try {
      const dataUrl = await blobToDataUrl(await fetch(photo.url).then((r) => r.blob()));
      setPendingPasFoto(dataUrl);
      navigate("/photo-studio/pas-foto-3x4");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal meneruskan foto.");
    }
  };

  /**
   * Pastikan gambar ber-bingkai mencerminkan PENGATURAN TERKINI (teks Booth
   * dan bingkai), lalu kembalikan peta URL → data URL ber-bingkai. Framing
   * hidup memakai nilai ter-debounce; bila tombol ekspor/cetak diklik tepat
   * setelah mengetik teks (dalam window debounce 300 ms) atau saat reframe
   * masih berjalan, peta lama bisa basi — di sini dibangun ulang dengan nilai
   * terkini agar PDF & cetak selalu memuat teks kustom yang sedang dilihat.
   */
  const ensureFreshFrames = async (): Promise<Record<string, string>> => {
    if (!frame) return {};
    const sig = photosSignature;
    const textsSig = rawTextsSig;
    const meta = framedMetaRef.current;
    const fresh =
      meta !== null &&
      meta.frameId === frame.id &&
      meta.hashtag === boothHashtag &&
      meta.banner === boothBanner &&
      meta.signature === sig &&
      meta.texts === textsSig &&
      photos.every((p) => framedMap[p.url]);
    if (fresh) return framedMap;
    const result = await frameAll(
      frameClients,
      photos,
      frame,
      size.widthPx,
      size.heightPx,
      { hashtagText: boothHashtag, bannerText: boothBanner },
      () => false,
      useFrameWorker
    );
    setFramedMap(result);
    framedMetaRef.current = {
      frameId: frame.id,
      hashtag: boothHashtag,
      banner: boothBanner,
      signature: sig,
      texts: textsSig,
    };
    return result;
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearLayoutSettings();
    setCols(maxCols(size, DEFAULT_MARGIN_CM));
    setRows(maxRows(size, DEFAULT_MARGIN_CM));
    setMarginCm(DEFAULT_MARGIN_CM);
    setShowLabels(false);
    setLabelSize("medium");
    setFrameId("");
    setCutLines(true);
    setBoothHashtag("#SENYUM");
    setBoothBanner("PHOTO BOOTH");
  };

  const handleExport = async () => {
    if (!canExport || exporting || printing) return;
    setError("");
    setExporting(true);
    try {
      const frames = await ensureFreshFrames();
      await exportLayoutPdf(size, photos.map((p) => frames[p.url] ?? p.url), {
        cols,
        rows,
        marginCm,
        paper,
        orientation,
        labels: showLabels ? photos.map((p) => p.name) : undefined,
        labelSizePt: showLabels ? labelSizeDef.pt : undefined,
        cutLines,
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
  const handlePrint = async () => {
    if (!canExport || exporting || printing) return;
    setError("");
    setPrinting(true);
    try {
      // Satu gambar per sel (berurutan); mode siklus memakai isian halaman ini.
      const items = multiPage ? photos : pageItems;
      const frames = await ensureFreshFrames();
      const srcs = items.map((p) => frames[p.url] ?? p.url);
      const html = buildHtmlSheet(srcs, size, {
        cols,
        rows,
        marginCm,
        paper,
        orientation,
        labels: showLabels ? items.map((p) => p.name) : undefined,
        labelSizePt: showLabels ? labelSizeDef.pt : undefined,
        cutLines,
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
                <div
                  className={`photo-item${
                    dragIdx === i ? " photo-item-dragging" : ""
                  }${overIdx === i ? " photo-item-over" : ""}`}
                  key={i}
                  onDragOver={(e) => {
                    if (dragIdx === null || dragIdx === i) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setOverIdx(i);
                  }}
                  onDragLeave={() =>
                    setOverIdx((cur) => (cur === i ? null : cur))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    setOverIdx(null);
                    if (dragIdx !== null && dragIdx !== i) movePhoto(dragIdx, i);
                    setDragIdx(null);
                  }}
                >
                  <img
                    src={p.url}
                    alt={p.name}
                    title="Seret untuk mengatur ulang urutan foto"
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(i);
                      setOverIdx(null);
                      e.dataTransfer.effectAllowed = "move";
                      // Data teks wajib agar drag mulai berjalan di Firefox.
                      e.dataTransfer.setData("text/plain", String(i));
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                  />
                  <input
                    className="photo-label-input"
                    value={p.name}
                    placeholder="Nama / keterangan"
                    title="Nama / keterangan untuk sel ini"
                    onChange={(e) => updateName(i, e.target.value)}
                  />
                  {boothTextFrameActive && (
                    <input
                      className="photo-booth-text-input"
                      value={p.boothText ?? ""}
                      maxLength={30}
                      placeholder={
                        frame.id === "booth-banner"
                          ? boothBanner
                          : boothHashtag
                      }
                      title="Teks Booth khusus foto ini — kosongkan untuk memakai teks default event"
                      onChange={(e) => updateBoothText(i, e.target.value)}
                    />
                  )}
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
              foto itu langsung ke alur crop Pas Foto 3x4. Seret thumbnail untuk
              mengatur ulang urutan foto — lembar, label, PDF, dan cetak
              mengikuti urutan baru.{" "}
              {boothTextFrameActive &&
                "Saat bingkai Booth bertulisan aktif, tiap foto bisa diberi teks sendiri (mis. nama tamu) — kosongkan untuk memakai teks default event."}
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
                  onChange={(e) => handleMarginChange(e.target.value)}
                />
              </label>
              <label>
                Kertas
                <select
                  className="tool-select"
                  value={paper.id}
                  onChange={(e) => selectPaper(e.target.value)}
                >
                  {PAPER_SIZES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                />
                Tampilkan nama di lembar
              </label>
              <FramePicker value={frameId} onChange={setFrameId} />
              {(frame?.id === "booth-hashtag" ||
                frame?.id === "booth-hashtag-warna") && (
                <label>
                  Teks hashtag (Booth)
                  <input
                    type="text"
                    maxLength={30}
                    value={boothHashtag}
                    placeholder="#SENYUM"
                    onChange={(e) => setBoothHashtag(e.target.value)}
                  />
                </label>
              )}
              {frame?.id === "booth-banner" && (
                <label>
                  Teks banner (Booth)
                  <input
                    type="text"
                    maxLength={30}
                    value={boothBanner}
                    placeholder="PHOTO BOOTH"
                    onChange={(e) => setBoothBanner(e.target.value)}
                  />
                </label>
              )}
              {boothTextFrameActive && (
                <p className="hint booth-text-hint">
                  💡 Teks default tersimpan dan tampil di pratinjau, PDF, dan
                  cetak; kosongkan untuk kembali ke teks default. Tiap foto di
                  strip bisa diberi teks sendiri (mis. nama tamu) lewat input di
                  bawah thumbnail — kosongkan input foto untuk memakai teks
                  default event.
                </p>
              )}
              <label className="label-toggle">
                <input
                  type="checkbox"
                  checked={cutLines}
                  onChange={(e) => setCutLines(e.target.checked)}
                />
                ✂️ Garis potong antar foto
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
                {exporting ? "Menyiapkan PDF…" : `⬇️ Ekspor PDF ${paper.name}`}
              </button>
              <ResetPreferencesButton
                title="Hapus pengaturan grid & label tersimpan modul ini"
                onReset={handleResetPrefs}
              />
            </div>

            {!canExport && (
              <p className="error">
                Grid {cols}×{rows} tidak muat di halaman {paper.name} dengan margin{" "}
                {marginCm} cm. Kurangi kolom/baris atau perbesar margin.
              </p>
            )}
          </section>

          <section className="panel sheet-section">
            <div className="sheet-head">
              <h2>Pratinjau Template {paper.name}</h2>
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
              paper={paper}
              orientation={orientation}
              labels={showLabels ? pageLabels : undefined}
              labelSizePx={showLabels ? labelSizeDef.previewPx : undefined}
              onDropPhoto={reorderPhoto}
              cutLines={cutLines}
            />
            <p className="hint">
              💡 Seret foto antar sel di lembar untuk mengatur ulang urutan —
              label, ekspor PDF, dan cetak mengikuti urutan baru. Bingkai yang
              dipilih diterapkan ke tiap foto di pratinjau, ekspor PDF, dan
              cetak. Garis potong putus-putus antar foto memudahkan pemotongan
              setelah cetak (bisa dimatikan di pengaturan). {multiPage
                ? "Setiap halaman disusun ulang secara terpisah."
                : photos.length < count
                  ? "Foto diulang bila lebih sedikit dari sel — urutan siklus mengikuti susunan baru."
                  : ""}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
