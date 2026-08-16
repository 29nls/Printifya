import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  canvasLikeToBlob,
  compareFormats,
  loadImageToCanvas,
  processImage,
  type DenoiseLevel,
  type FormatStat,
  type OutFormat,
} from "./waifu2x";
import type {
  Waifu2xWorkerRequestNoId,
  Waifu2xWorkerResponse,
} from "./waifu2xWorkerApi";
import { createWorkerClient } from "../../shared/createWorkerClient";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import {
  setPendingLayoutPhoto,
  setPendingLayoutPhotos,
} from "../../shared/autoLayoutBridge";
import { decideFormatToggle, sortFormatStats } from "./formatCompare";
import {
  clearW2xOptions,
  DEFAULT_W2X_OPTIONS,
  loadLayoutPrefix,
  loadW2xOptions,
  saveLayoutPrefix,
  saveW2xOptions,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

interface Item {
  id: string;
  name: string;
  origUrl: string;
  w: number;
  h: number;
  resultUrl: string | null;
  resultW: number;
  resultH: number;
  status: "menunggu" | "memproses" | "selesai" | "gagal";
  /** Skala & format yang benar-benar dipakai saat proses (untuk nama file). */
  usedScale?: number;
  usedFormat?: OutFormat;
  /** Ukuran + PSNR tiap format (PNG/WebP/JPG) untuk perbandingan kualitas.
   *  Dihitung on-demand saat tabel "📊 Format" dibuka, lalu di-cache. */
  formats?: FormatStat[];
  /** Bitmap hasil (jalur worker) — referensi lossless untuk perbandingan
   *  format; di-transfer kembali ke worker saat compare, lalu dibuang. */
  resultBitmap?: ImageBitmap | null;
  /** Kanvas hasil (jalur fallback tanpa worker) — sumber compare di thread
   *  utama; dibuang setelah dipakai. */
  resultCanvas?: HTMLCanvasElement | null;
  error?: string;
}

const SCALE_PRESETS = [
  { id: "2x", label: "2×", value: 2 },
  { id: "4x", label: "4×", value: 4 },
  { id: "8x", label: "8×", value: 8 },
  { id: "custom", label: "Kustom", value: null },
] as const;

const DENOISE_LABELS: Record<number, string> = {
  0: "Tanpa",
  1: "Rendah",
  2: "Sedang",
  3: "Tinggi",
};

/**
 * Preset model gaya Waifu2x-Extension-GUI. Modul ini heuristik (tanpa
 * jaringan saraf), jadi setiap nama model nyata dipetakan ke profil pipeline
 * (skala/denoise/TTA) yang meniru perilakunya: HQ = kualitas tertinggi,
 * Conservative = perubahan lebih hati-hati, Small = untuk foto kecil,
 * Fast = cepat & universal. Kombinasi (scaleId, denoise, tta) tiap model
 * unik, sehingga model aktif bisa diturunkan dari pengaturan saat ini. */
interface ModelPreset {
  id: string;
  name: string;
  desc: string;
  scaleId: string; // "2x" | "4x"
  denoise: DenoiseLevel;
  tta: boolean;
}

const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "photo-hq-w4x",
    name: "Photo-HQ-W4xEX",
    desc: "Kualitas tertinggi untuk foto — 4× + denoise Tinggi + TTA.",
    scaleId: "4x",
    denoise: 3,
    tta: true,
  },
  {
    id: "photo-conservative-x4",
    name: "Photo-Conservative-x4",
    desc: "Konservatif — 4× + denoise Sedang, detail asli lebih terjaga.",
    scaleId: "4x",
    denoise: 2,
    tta: false,
  },
  {
    id: "photo-small-w2x",
    name: "Photo-Small-W2xEX",
    desc: "Untuk foto kecil — 2× + denoise Sedang.",
    scaleId: "2x",
    denoise: 2,
    tta: false,
  },
  {
    id: "universal-fast-w2x",
    name: "Universal-Fast-W2xEX",
    desc: "Cepat & universal — 2× + denoise Rendah.",
    scaleId: "2x",
    denoise: 1,
    tta: false,
  },
];

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const FMT_LABEL: Record<OutFormat, string> = {
  png: "PNG (lossless)",
  webp: "WebP",
  jpg: "JPG",
};

/** Batas aman pekerjaan batch paralel. Worker memproses serial (satu antrean
 *  per-id), jadi di atas batas ini konkurrensi hanya menumpuk bitmap di
 *  memori tanpa mempercepat batch. */
const BATCH_CONCURRENCY_CAP = 6;
/** Konkurrensi batch mengikuti jumlah inti (navigator.hardwareConcurrency)
 *  agar batch besar memanfaatkan worker sebaik mungkin, dibatasi batas aman;
 *  minimal 2 agar fase main-thread (fetch/decode item berikutnya) tetap
 *  tumpang tindih dengan pemrosesan worker. */
const BATCH_CONCURRENCY = Math.min(
  BATCH_CONCURRENCY_CAP,
  Math.max(
    2,
    typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2
  )
);

export default function UpscaleDenoisePage() {
  const [items, setItems] = useState<Item[]>([]);
  // Pengaturan proses — default dari localStorage, disimpan ulang setiap
  // berubah (pola optionsStorage.ts di Background Removal).
  const [initialOpts] = useState(loadW2xOptions);
  const [scaleId, setScaleId] = useState<string>(initialOpts.scaleId);
  const [customScale, setCustomScale] = useState(initialOpts.customScale);
  const [denoise, setDenoise] = useState<DenoiseLevel>(
    initialOpts.denoise as DenoiseLevel
  );
  const [tta, setTta] = useState(initialOpts.tta);
  const [outFormat, setOutFormat] = useState<OutFormat>(
    initialOpts.outFormat as OutFormat
  );
  const [quality, setQuality] = useState(initialOpts.quality);
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [showFormats, setShowFormats] = useState<string | null>(null);
  /** Id item yang sedang dihitung perbandingan formatnya (indikator loading).
   *  Set per-id agar komputasi tiap item hanya satu (guard tidak bisa
   *  dikelabui komputasi paralel item lain). */
  const [formatLoading, setFormatLoading] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [split, setSplit] = useState(50);
  const [error, setError] = useState("");
  /** Awalan nama default saat hasil dikirim ke Auto Layout (label lembar). */
  const [layoutPrefix, setLayoutPrefix] = useState(loadLayoutPrefix);
  const [forwarding, setForwarding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  /** Pembatalan batch: disetel saat unmount agar loop tidak melanjutkan
   *  pemrosesan / update state setelah modul ditutup (pola cancelled flag). */
  const cancelledRef = useRef(false);
  /** ImageBitmap hasil yang masih dipegang item — dibebaskan eksplisit saat
   *  item dihapus / modul unmount (bukan hanya mengandalkan GC). */
  const resultBitmapsRef = useRef<Set<ImageBitmap>>(new Set());
  const navigate = useNavigate();

  const scale = SCALE_PRESETS.find((s) => s.id === scaleId)?.value ?? customScale;

  // Model aktif diturunkan dari pengaturan (kombinasi tiap preset unik):
  // bila pengguna mengubah skala/denoise/TTA manual, model otomatis menjadi
  // "kustom" tanpa state tambahan.
  const activeModel = MODEL_PRESETS.find(
    (p) => p.scaleId === scaleId && p.denoise === denoise && p.tta === tta
  );

  /** Terapkan preset model: atur skala/denoise/TTA sesuai profilnya. */
  const applyModel = (p: ModelPreset) => {
    setScaleId(p.scaleId);
    setDenoise(p.denoise);
    setTta(p.tta);
  };

  // Pipeline berat (upscale/denoise/TTA) dijalankan di Web Worker + OffscreenCanvas
  // agar batch tidak membekukan UI; fallback thread utama bila tidak didukung.
  const offscreenWorker =
    typeof OffscreenCanvas !== "undefined" && typeof Worker !== "undefined";
  const workerClient = useMemo(
    () =>
      createWorkerClient<Waifu2xWorkerRequestNoId, Waifu2xWorkerResponse>({
        createWorker: () =>
          new Worker(new URL("./waifu2x.worker.ts", import.meta.url), {
            type: "module",
          }),
        errorMessage: "Worker gagal memproses gambar.",
      }),
    []
  );

  useEffect(
    () => () => {
      cancelledRef.current = true;
      urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      resultBitmapsRef.current.forEach((b) => b.close());
      resultBitmapsRef.current.clear();
      workerClient.terminate();
    },
    []
  );

  /** Beri browser kesempatan menggambar & memproses input antar item batch
   *  (rAF memastikan paint, fallback timeout untuk tab yang tidak terlihat). */
  const yieldToUi = () =>
    new Promise<void>((resolve) => {
      const fallback = setTimeout(() => resolve(), 80);
      requestAnimationFrame(() => {
        clearTimeout(fallback);
        setTimeout(resolve, 0);
      });
    });

  // Persist pengaturan proses & awalan label.
  useEffect(() => {
    saveW2xOptions({ scaleId, customScale, denoise, tta, outFormat, quality });
  }, [scaleId, customScale, denoise, tta, outFormat, quality]);
  useEffect(() => {
    saveLayoutPrefix(layoutPrefix);
  }, [layoutPrefix]);

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearW2xOptions();
    setScaleId(DEFAULT_W2X_OPTIONS.scaleId);
    setCustomScale(DEFAULT_W2X_OPTIONS.customScale);
    setDenoise(DEFAULT_W2X_OPTIONS.denoise as DenoiseLevel);
    setTta(DEFAULT_W2X_OPTIONS.tta);
    setOutFormat(DEFAULT_W2X_OPTIONS.outFormat as OutFormat);
    setQuality(DEFAULT_W2X_OPTIONS.quality);
    setLayoutPrefix("waifu2x-");
  };

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError("");
    const next: Item[] = Array.from(files).map((f) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: f.name,
      origUrl: URL.createObjectURL(f),
      w: 0,
      h: 0,
      resultUrl: null,
      resultW: 0,
      resultH: 0,
      status: "menunggu",
    }));
    urlsRef.current.push(...next.map((i) => i.origUrl));
    setItems((prev) => [...prev, ...next]);
    // Isi dimensi asli tiap gambar (untuk info & compare).
    next.forEach((it) => {
      const img = new Image();
      img.onload = () => {
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, w: img.naturalWidth, h: img.naturalHeight } : x))
        );
      };
      img.src = it.origUrl;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeItem = (id: string) => {
    const it = items.find((x) => x.id === id);
    if (it) {
      URL.revokeObjectURL(it.origUrl);
      if (it.resultBitmap) {
        resultBitmapsRef.current.delete(it.resultBitmap);
        it.resultBitmap.close();
      }
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (compareId === id) setCompareId(null);
  };

  const processOne = async (it: Item): Promise<void> => {
    if (cancelledRef.current) return;
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, status: "memproses" } : x))
    );
    try {
      let blob: Blob;
      let resultW = 0;
      let resultH = 0;
      let resultBitmap: ImageBitmap | null = null;
      let fallbackCanvas: HTMLCanvasElement | null = null;
      if (offscreenWorker) {
        // Jalur worker: decode ImageBitmap (off-main-thread), transfer ke
        // worker, pipeline di OffscreenCanvas, hasil balik sebagai blob +
        // bitmap. Thread utama TIDAK menggambar apa pun — bitmap hasil
        // disimpan apa adanya (referensi compare, di-transfer balik saat
        // tabel "📊 Format" dibuka).
        const bmp = await fetch(it.origUrl)
          .then((r) => r.blob())
          .then((b) => createImageBitmap(b));
        if (cancelledRef.current) {
          // Dibatalkan saat decode — bebaskan bitmap sumber (belum di-transfer).
          bmp.close();
          return;
        }
        const res = await workerClient.post(
          { type: "process", bitmap: bmp, options: { scale, denoise, tta }, format: outFormat, quality: quality / 100 },
          [bmp]
        );
        if (cancelledRef.current) {
          // Dibatalkan saat worker memproses — balikan yang sudah tiba dibuang;
          // bitmap hasil (jika ada) dibebaskan agar tidak bocor ke GC.
          if (res.ok && res.type === "process") res.bitmap.close();
          return;
        }
        if (!res.ok) throw new Error(res.error);
        if (res.type !== "process") throw new Error("Respons worker tak terduga.");
        blob = res.blob;
        resultW = res.width;
        resultH = res.height;
        resultBitmap = res.bitmap;
        resultBitmapsRef.current.add(res.bitmap);
      } else {
        // Fallback browser lama (tanpa OffscreenCanvas): pipeline di thread
        // utama — factory default membuat HTMLCanvasElement.
        const src = await loadImageToCanvas(it.origUrl);
        if (cancelledRef.current) return;
        const processed = processImage(src, { scale, denoise, tta });
        blob = await canvasLikeToBlob(processed, outFormat, quality / 100);
        fallbackCanvas = processed as HTMLCanvasElement;
        resultW = processed.width;
        resultH = processed.height;
      }
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      // Perbandingan format TIDAK dihitung di sini — mahal (3 encode + PSNR
      // resolusi penuh) dan tidak selalu dibutuhkan. Referensi compare
      // (bitmap di jalur worker, kanvas di jalur fallback) disimpan di item;
      // tabel "📊 Format" menghitungnya on-demand (di worker).
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id
            ? {
                ...x,
                status: "selesai",
                resultUrl: url,
                resultW,
                resultH,
                usedScale: scale,
                usedFormat: outFormat,
                formats: undefined,
                resultBitmap,
                resultCanvas: fallbackCanvas,
              }
            : x
        )
      );
    } catch (e) {
      // Dibatal? Item sudah dikembalikan ke "menunggu" oleh cancelBatch —
      // jangan menandai "gagal" untuk pembatalan (termasuk reject postWorker
      // dari Batal/terminate).
      if (cancelledRef.current) return;
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id
            ? { ...x, status: "gagal", error: e instanceof Error ? e.message : "Gagal." }
            : x
        )
      );
    }
  };

  /** Buka tabel perbandingan format (PNG/WebP/JPG) untuk satu item.
   *  Dihitung on-demand dengan indikator loading, hasil di-cache di item
   *  (buka ulang instan); referensi compare (bitmap/kanvas) dibuang setelah
   *  dipakai. Keputusan toggle (cache / guard per-id / tutup) dihitung murni
   *  di `decideFormatToggle` agar bisa diuji unit. */
  const toggleFormats = async (it: Item) => {
    const decision = decideFormatToggle(it, {
      openId: showFormats,
      loading: formatLoading,
    });
    if (decision.action === "close") {
      setShowFormats(null);
      return;
    }
    setShowFormats(it.id);
    if (decision.action !== "compute") return; // cache / sedang dihitung
    setFormatLoading((prev) => new Set(prev).add(it.id));
    try {
      let formats: FormatStat[];
      if (offscreenWorker) {
        // Jalur worker: transfer bitmap hasil (referensi lossless, tanpa
        // salin) ke worker — encode PNG/WebP/JPG + PSNR terjadi di sana,
        // thread utama tidak menyentuh tabel sama sekali. Bila bitmap tidak
        // ada ATAU sudah detached (width/height 0 — sudah di-transfer/ditutup
        // oleh compare yang gagal), buat baru dari URL hasil agar retry tidak
        // pernah mengirim bitmap terdetach ke worker.
        let bmp = it.resultBitmap;
        if (!bmp || bmp.width === 0 || bmp.height === 0) {
          const blob = await fetch(it.resultUrl!).then((r) => r.blob());
          bmp = await createImageBitmap(blob);
        }
        const res = await workerClient.post(
          { type: "compare", bitmap: bmp, quality },
          [bmp]
        );
        if (!res.ok) throw new Error(res.error);
        if (res.type !== "compare") throw new Error("Respons worker tak terduga.");
        formats = res.stats;
        // Bitmap telah di-transfer (netral di thread utama) — lepas dari
        // pelacakan tanpa close.
        resultBitmapsRef.current.delete(bmp);
      } else {
        // Fallback browser lama: compare di thread utama (perilaku lama).
        const canvas =
          it.resultCanvas ?? (await loadImageToCanvas(it.resultUrl!));
        formats = await compareFormats(canvas, quality);
      }
      setItems((prev) =>
        prev.map((x) =>
          x.id === it.id
            ? { ...x, formats, resultBitmap: null, resultCanvas: null }
            : x
        )
      );
    } catch (e) {
      setShowFormats(null);
      setError(e instanceof Error ? e.message : "Gagal membandingkan format.");
    } finally {
      setFormatLoading((prev) => {
        if (!prev.has(it.id)) return prev;
        const next = new Set(prev);
        next.delete(it.id);
        return next;
      });
    }
  };

  /** Hentikan batch di tengah jalan: semua permintaan worker yang masih
   *  tertunda ditolak & worker di-terminate (antrean dibatalkan seketika,
   *  bukan menunggu selesai), pool berhenti menarik item baru, dan semua item
   *  belum selesai dikembalikan ke "menunggu" agar batch bisa diulang. State
   *  tetap hidup — hanya pemrosesan yang dibatalkan. */
  const cancelBatch = () => {
    if (!processing) return;
    cancelledRef.current = true;
    // Tolak semua permintaan tertunda & hentikan worker (antrean dibatalkan
    // seketika — pool berhenti karena postWorker menolak).
    workerClient.terminate(new Error("Batch dibatalkan."));
    setItems((prev) =>
      prev.map((x) =>
        x.status === "memproses" || x.status === "menunggu"
          ? { ...x, status: "menunggu", error: undefined }
          : x
      )
    );
  };

  const runAll = async () => {
    if (processing) return;
    // Prioritas ukuran: foto kecil diproses lebih dulu (area piksel naik) agar
    // hasil pertama cepat muncul di batch campuran ukuran. Item tanpa dimensi
    // (w/h belum terbaca saat upload) ditaruh paling akhir (dianggap besar).
    // filter() membuat salinan, jadi sort tidak menyentuh state items.
    const queue = items
      .filter((i) => i.status !== "selesai" && i.status !== "gagal")
      .sort((a, b) => (a.w * a.h || Infinity) - (b.w * b.h || Infinity));
    if (queue.length === 0) {
      setError("Tidak ada foto yang menunggu. Upload foto dulu.");
      return;
    }
    setError("");
    cancelledRef.current = false;
    setProcessing(true);
    try {
      // Jalankan beberapa item sekaligus alih-alih berurutan: semua kerja
      // berat ada di worker (pesan per-id), sehingga worker tidak pernah
      // menunggu thread utama (fetch/decode item berikutnya berjalan saat
      // item lain masih diproses). Badge per-item & progress bar ter-update
      // karena tiap item selesai secara independen.
      let next = 0;
      const pool = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, queue.length) },
        async () => {
          while (next < queue.length) {
            if (cancelledRef.current) return;
            const it = queue[next++];
            await processOne(it);
            // Yield antar pekerjaan: badge progress & kontrol ter-update
            // selama batch berjalan.
            await yieldToUi();
          }
        }
      );
      await Promise.all(pool);
    } finally {
      setProcessing(false);
    }
  };

  const resultFileName = (it: Item): string => {
    const fmt = it.usedFormat ?? outFormat;
    const ext = fmt === "jpg" ? "jpg" : fmt;
    const s = it.usedScale ?? scale;
    return `${it.name.replace(/\.[^.]+$/, "")}-${s}x-waifu2x.${ext}`;
  };

  const download = (it: Item) => {
    if (!it.resultUrl) return;
    const a = document.createElement("a");
    a.href = it.resultUrl;
    a.download = resultFileName(it);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  /** Unduh semua hasil siap — berurutan dengan jeda agar browser tidak
   *  menganggapnya spam unduhan (jendela aktivasi pengguna ±5 detik). */
  const downloadAll = async () => {
    if (downloading || processing) return;
    const ready = items.filter((i) => i.resultUrl);
    if (ready.length === 0) {
      setError("Belum ada hasil yang bisa diunduh. Proses foto dulu.");
      return;
    }
    setError("");
    setDownloading(true);
    for (let i = 0; i < ready.length; i++) {
      const it = ready[i];
      const a = document.createElement("a");
      a.href = it.resultUrl!;
      a.download = resultFileName(it);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDlProgress(i + 1);
      await new Promise((r) => setTimeout(r, 350));
    }
    setDlProgress(0);
    setDownloading(false);
  };

  /** Konversi blob URL hasil → data URL (mandiri). Blob URL di-revoke saat
   *  modul unmount, sedangkan data URL aman diteruskan ke modul lain. */
  const toDataUrl = (url: string): Promise<string> =>
    fetch(url)
      .then((r) => r.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(fr.error ?? new Error("Gagal membaca hasil."));
            fr.readAsDataURL(blob);
          })
      );

  /** Teruskan satu hasil ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = async (it: Item) => {
    if (!it.resultUrl || forwarding) return;
    setForwarding(true);
    try {
      setPendingPasFoto(await toDataUrl(it.resultUrl));
      navigate("/photo-studio/pas-foto-3x4");
    } catch {
      setError("Gagal menyiapkan hasil untuk pas foto.");
    } finally {
      setForwarding(false);
    }
  };

  /** Kirim satu hasil ke Auto Layout untuk lembar A4. */
  const forwardToLayout = async (it: Item) => {
    if (!it.resultUrl || forwarding) return;
    setForwarding(true);
    try {
      const base = it.name.replace(/\.[^.]+$/, "") || "upscaled";
      setPendingLayoutPhoto(await toDataUrl(it.resultUrl), `${layoutPrefix}${base}`);
      navigate("/ai-assistant/auto-layout");
    } catch {
      setError("Gagal menyiapkan hasil untuk Auto Layout.");
    } finally {
      setForwarding(false);
    }
  };

  /** Kirim semua hasil siap sekaligus ke Auto Layout (batch). */
  const forwardAllToLayout = async () => {
    if (forwarding) return;
    const ready = items.filter((i) => i.resultUrl);
    if (ready.length === 0) {
      setError("Belum ada hasil yang bisa disusun. Proses foto dulu.");
      return;
    }
    setError("");
    setForwarding(true);
    try {
      const photos = await Promise.all(
        ready.map(async (it) => {
          const base = it.name.replace(/\.[^.]+$/, "") || "upscaled";
          return {
            url: await toDataUrl(it.resultUrl!),
            name: `${layoutPrefix}${base}`,
          };
        })
      );
      setPendingLayoutPhotos(photos);
      navigate("/ai-assistant/auto-layout");
    } catch {
      setError("Gagal menyiapkan hasil untuk Auto Layout.");
    } finally {
      setForwarding(false);
    }
  };

  const doneCount = items.filter((i) => i.status === "selesai").length;
  const compareItem = items.find((i) => i.id === compareId) ?? null;

  return (
    <div className="w2x-page">
      <header className="module-header">
        <span className="module-icon">⬆️</span>
        <div>
          <h1>Upscale &amp; Denoise</h1>
          <p>
            Perbesar resolusi &amp; kurangi noise foto bergaya{" "}
            <strong>Waifu2x-Extension-GUI</strong> — preset model
            (Photo-HQ-W4xEX, Photo-Conservative-x4, Photo-Small-W2xEX,
            Universal-Fast-W2xEX), skala 2×–8×/kustom, denoise 0–3, TTA, batch,
            dan perbandingan sebelum/sesudah. Implementasi heuristik (resize
            bertahap + median filter), tanpa jaringan saraf.
          </p>
        </div>
      </header>

      <div className="w2x-layout">
        <section className="panel">
          <div className="archive-head">
            <h2>Foto</h2>
            <div className="archive-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={processing || downloading}
                onClick={() => inputRef.current?.click()}
              >
                📤 Upload Foto (batch)
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  downloading ||
                  processing ||
                  items.filter((i) => i.resultUrl).length === 0
                }
                onClick={downloadAll}
                title="Unduh semua hasil batch sekaligus (berurutan, aman untuk browser)"
              >
                {downloading
                  ? `Mengunduh ${dlProgress}/${items.filter((i) => i.resultUrl).length}…`
                  : `⬇️ Unduh Semua (${items.filter((i) => i.resultUrl).length})`}
              </button>
              <button
                type="button"
                className="btn"
                disabled={
                  forwarding ||
                  processing ||
                  items.filter((i) => i.resultUrl).length === 0
                }
                onClick={forwardAllToLayout}
                title="Kirim semua hasil batch ke Auto Layout untuk lembar A4"
              >
                {forwarding ? "Menyiapkan…" : `🧩 Susun Semua ke A4 (${items.filter((i) => i.resultUrl).length})`}
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />

          {items.length === 0 ? (
            <p className="hint">
              Upload satu atau banyak foto sekaligus. Tiap foto diproses ke
              resolusi lebih tinggi + pengurangan noise sesuai pengaturan.
            </p>
          ) : (
            <ul className="w2x-list">
              {items.map((it) => (
                <li key={it.id}>
                  <div className="w2x-item">
                    <img src={it.origUrl} alt="" className="w2x-thumb" />
                    <div className="w2x-info">
                      <strong>{it.name}</strong>
                      <span>
                        {it.w}×{it.h} →{" "}
                        {it.status === "selesai" && it.resultUrl
                          ? `${it.resultW}×${it.resultH}`
                          : "—"}
                      </span>
                      {it.error && <em>{it.error}</em>}
                    </div>
                    <span className={`w2x-badge w2x-${it.status}`}>
                      {it.status === "memproses"
                        ? "memproses…"
                        : it.status === "selesai"
                          ? "selesai"
                          : it.status === "gagal"
                            ? "gagal"
                            : "menunggu"}
                    </span>
                    <div className="w2x-actions">
                      {it.resultUrl && (
                        <>
                          <button
                            type="button"
                            className="btn"
                            disabled={forwarding}
                            onClick={() => forwardToPasFoto(it)}
                            title="Teruskan hasil ini ke alur crop Pas Foto 3x4"
                          >
                            🪪 Jadikan Pas Foto 3x4
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={forwarding}
                            onClick={() => forwardToLayout(it)}
                            title="Kirim hasil ini ke Auto Layout untuk lembar A4"
                          >
                            🧩 Susun ke A4
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => toggleFormats(it)}
                            title="Bandingkan ukuran & PSNR PNG/WebP/JPG (dihitung saat dibuka)"
                          >
                            {formatLoading.has(it.id) ? "⏳" : "📊"} Format
                          </button>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              setCompareId(it.id);
                              setSplit(50);
                            }}
                          >
                            🔍 Bandingkan
                          </button>
                          <button type="button" className="btn btn-primary" onClick={() => download(it)}>
                            ⬇️ Unduh
                          </button>
                        </>
                      )}
                      <button type="button" className="btn np-del" title="Hapus" onClick={() => removeItem(it.id)}>
                        🗑
                      </button>
                    </div>
                  </div>
                  {showFormats === it.id && (
                    <div className="w2x-formats">
                      {it.formats ? (
                        <>
                          <table>
                            <thead>
                              <tr>
                                <th>Format</th>
                                <th>Ukuran</th>
                                <th>PSNR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortFormatStats(it.formats).map((f, i) => (
                                <tr
                                  key={f.format}
                                  className={
                                    f.format === it.usedFormat
                                      ? "w2x-fmt-used"
                                      : ""
                                  }
                                >
                                  <td>
                                    {FMT_LABEL[f.format]}
                                    {f.format === it.usedFormat && " ✓"}
                                    {/* Baris terbaik (setelah urut): badge
                                        peringkat. Tidak tampil bila semua gagal
                                        decode (psnrDb null semua). */}
                                    {i === 0 && f.psnrDb != null && (
                                      <span
                                        className="w2x-best"
                                        title="Kualitas terbaik menurut PSNR"
                                      >
                                        ⚡ terbaik
                                      </span>
                                    )}
                                  </td>
                                  <td>{fmtSize(f.size)}</td>
                                  <td>
                                    {f.format === "png"
                                      ? "lossless"
                                      : f.psnrDb == null
                                        ? "—"
                                        : Number.isFinite(f.psnrDb)
                                          ? `${f.psnrDb.toFixed(1)} dB`
                                          : "∞ dB"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="hint">
                            PSNR = perbandingan kualitas versi lossy terhadap
                            kanvas asli (makin tinggi makin dekat). Format yang
                            dipakai untuk unduhan ditandai ✓ — kualitas WebP/JPG
                            mengikuti pengaturan ({quality}%). Baris diurutkan
                            dari kualitas terbaik ke terburuk.
                          </p>
                          <div className="legend">
                            <span>
                              <strong>∞ dB</strong> = rekonstruksi identik
                              (tanpa kehilangan)
                            </span>
                            <span>
                              <strong>—</strong> = gagal di-decode di browser
                              ini
                            </span>
                          </div>
                        </>
                      ) : (
                        <p className="hint">
                          ⏳ Menghitung ukuran &amp; PSNR PNG/WebP/JPG…
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {items.length > 0 && (
            <div className="w2x-progress">
              <div className="w2x-progress-bar">
                <div
                  className="w2x-progress-fill"
                  style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }}
                />
              </div>
              <span>
                {doneCount}/{items.length} selesai
              </span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
        </section>

        <section className="panel">
          <h2>Pengaturan (Waifu2x-style)</h2>

          <div className="w2x-field">
            <span>Model (preset gaya Waifu2x-Extension-GUI)</span>
            <div className="preset-picker">
              {MODEL_PRESETS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  title={m.desc}
                  className={`chip ${activeModel?.id === m.id ? "active" : ""}`}
                  onClick={() => applyModel(m)}
                >
                  {m.name}
                </button>
              ))}
              <button
                type="button"
                className={`chip ${!activeModel ? "active" : ""}`}
                onClick={() => {
                  // Kustom: kembalikan ke profil manual default modul.
                  setScaleId("4x");
                  setDenoise(0);
                  setTta(false);
                }}
              >
                Kustom
              </button>
            </div>
            <p className="hint">
              Profil heuristik yang meniru model nyata Waifu2x-Extension-GUI
              (tanpa jaringan saraf): memilih model mengatur skala, denoise,
              dan TTA sekaligus. Mengubah pengaturan manual → Kustom.
            </p>
          </div>

          <div className="w2x-field">
            <span>Skala perbesaran</span>
            <div className="preset-picker">
              {SCALE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`chip ${scaleId === p.id ? "active" : ""}`}
                  onClick={() => setScaleId(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {scaleId === "custom" && (
              <label className="w2x-range">
                <input
                  type="range"
                  min={1}
                  max={8}
                  step={0.5}
                  value={customScale}
                  onChange={(e) => setCustomScale(Number(e.target.value))}
                />
                <span>{customScale}×</span>
              </label>
            )}
          </div>

          <div className="w2x-field">
            <span>Pengurangan noise (denoise)</span>
            <div className="preset-picker">
              {[0, 1, 2, 3].map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`chip ${denoise === l ? "active" : ""}`}
                  onClick={() => setDenoise(l as DenoiseLevel)}
                >
                  {DENOISE_LABELS[l]}
                </button>
              ))}
            </div>
            <p className="hint">
              Median filter 3×3 / 5×5 — mengurangi noise sambil menjaga tepi.
            </p>
          </div>

          <label className="label-toggle">
            <input
              type="checkbox"
              checked={tta}
              onChange={(e) => setTta(e.target.checked)}
            />
            <span>
              <strong>TTA</strong> — rata-rata 4 orientasi (lebih halus, ±4×
              lebih lambat)
            </span>
          </label>

          <div className="w2x-field">
            <span>Format output</span>
            <div className="preset-picker">
              {(["png", "webp", "jpg"] as OutFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`chip ${outFormat === f ? "active" : ""}`}
                  onClick={() => setOutFormat(f)}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            {outFormat !== "png" && (
              <label className="w2x-range">
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
                <span>kualitas {quality}%</span>
              </label>
            )}
          </div>

          <div className="w2x-prefs-row">
            <label className="layout-prefix">
              🧩 Awalan label di lembar Auto Layout
              <input
                type="text"
                value={layoutPrefix}
                placeholder="mis. waifu2x-"
                onChange={(e) => setLayoutPrefix(e.target.value)}
              />
            </label>
            <ResetPreferencesButton
              title="Hapus pengaturan proses & awalan label tersimpan modul ini"
              onReset={handleResetPrefs}
            />
          </div>

          <div className="w2x-run-row">
            <button
              type="button"
              className="btn btn-primary w2x-run"
              disabled={processing || items.length === 0}
              onClick={runAll}
            >
              {processing
                ? `Memproses… (${doneCount}/${items.length} diproses)`
                : "⚡ Proses Semua"}
            </button>
            {processing && (
              <button
                type="button"
                className="btn w2x-run"
                onClick={cancelBatch}
                title="Hentikan batch: item yang menunggu berhenti, yang sedang diproses dikembalikan ke 'menunggu'"
              >
                ✋ Batal
              </button>
            )}
          </div>

          <p className="hint">
            💡 Nama file hasil: <code>nama-{scale}x-waifu2x.{outFormat}</code>.
            "Unduh Semua" mengunduh berurutan (jeda 350 ms) agar browser tidak
            memblokir banyak unduhan; bila browser tetap memblokir, izinkan
            "multiple downloads" atau gunakan tombol unduh per foto. Hasil bisa
            diteruskan ke Auto Layout ("Susun ke A4" / "Susun Semua ke A4") atau
            langsung ke alur crop pas foto ("Jadikan Pas Foto 3x4"). TTA adalah
            padanan heuristik test-time augmentation waifu2x — hasil nyata
            bergantung pada kualitas sumber (tanpa model ML).
          </p>
        </section>

        {compareItem && compareItem.resultUrl && (
          <section className="panel w2x-compare">
            <div className="archive-head">
              <h2>Perbandingan — {compareItem.name}</h2>
              <button type="button" className="btn" onClick={() => setCompareId(null)}>
                ✕ Tutup
              </button>
            </div>
            <div className="w2x-compare-wrap">
              <div className="w2x-compare-img">
                <img src={compareItem.origUrl} alt="Sebelum" />
              </div>
              <div
                className="w2x-compare-img w2x-compare-overlay"
                style={{ clipPath: `inset(0 0 0 ${split}%)` }}
              >
                <img src={compareItem.resultUrl} alt="Sesudah" />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={split}
                className="w2x-compare-slider"
                onChange={(e) => setSplit(Number(e.target.value))}
              />
            </div>
            <p className="hint">
              Geser pembatas: kiri = asli ({compareItem.w}×{compareItem.h}),
              kanan = hasil ({compareItem.resultW}×{compareItem.resultH}).
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
