import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  applyBackgroundColor,
  removeBackground,
  type RemoveBgOptions,
} from "./bgRemove";
import type {
  BgWorkerRequestNoId,
  BgWorkerResponse,
} from "./bgRemoveWorkerApi";
import { createWorkerClient } from "../../shared/createWorkerClient";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import { blobToDataUrl, downloadUrl } from "../../shared/downloadUrl";
import SyncedPhotoCompare from "../../shared/SyncedPhotoCompare";
import {
  clearBgOptions,
  loadLayoutPrefix,
  loadSegOptions,
  saveLayoutPrefix,
  saveSegOptions,
} from "./bgOptionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

interface BgOption {
  id: string;
  name: string;
  /** Warna polos pengganti; null = pertahankan transparan. */
  hex: string | null;
}

const BG_OPTIONS: BgOption[] = [
  { id: "transparent", name: "Transparan", hex: null },
  { id: "white", name: "Putih", hex: "#ffffff" },
  { id: "blue", name: "Biru", hex: "#2e6db4" },
  { id: "red", name: "Merah", hex: "#c62828" },
];

type Step = "upload" | "result";

export default function BackgroundRemovalPage() {
  const [step, setStep] = useState<Step>("upload");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [bgId, setBgId] = useState<string>("transparent");
  // Awalan nama terusan — default dari localStorage (pola storage.ts).
  const [layoutPrefix, setLayoutPrefix] = useState(loadLayoutPrefix);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  // Kanvas tampilan panel banding (komposit checkerboard bila transparan —
  // visualisasi alpha; TIDAK dipakai untuk unduh/terusan, `resultUrl` tetap
  // hasil mentah). Di-redraw saat proses selesai / opsi latar berubah.
  const [compareCanvas, setCompareCanvas] = useState<HTMLCanvasElement | null>(
    null
  );
  // Komposit/encode hasil berjalan di Web Worker — busy ringan (chip nonaktif
  // + hint) saat ganti latar atau ekspor mask.
  const [bgBusy, setBgBusy] = useState(false);
  // Opsi segmen ala rembg (--post-process-mask, -a, --alpha-matting-erode-size)
  // — default dari localStorage, disimpan ulang setiap berubah.
  const [postProcess, setPostProcess] = useState(() => loadSegOptions().postProcess);
  const [matting, setMatting] = useState(() => loadSegOptions().matting);
  const [erodeSize, setErodeSize] = useState(() => loadSegOptions().erodeSize);

  // Persist opsi segmen & awalan label.
  useEffect(() => {
    saveSegOptions({ postProcess, matting, erodeSize });
  }, [postProcess, matting, erodeSize]);
  useEffect(() => {
    saveLayoutPrefix(layoutPrefix);
  }, [layoutPrefix]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Kanvas hasil transparan (sumber untuk pewarnaan ulang tanpa reproses).
  const transparentRef = useRef<HTMLCanvasElement | null>(null);
  // Mask grayscale resolusi penuh (untuk tombol "Unduh Mask").
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  // Gambar asli yang sudah dimuat (untuk reproses saat opsi berubah).
  const imgRef = useRef<HTMLImageElement | null>(null);
  // Token urutan file: naik setiap handleFile — hasil async (decode/pemrosesan)
  // dari file lama yang selesai belakangan diabaikan agar tidak menimpa hasil
  // file terbaru (pola autoSeq di auto-crop-face / fileTokenRef di VFE).
  const fileSeqRef = useRef(0);
  // Worker memiliki ImageBitmap hasil + mask (createImageBitmap + transfer
  // zero-copy) — komposit & encode PNG berjalan di luar thread utama.
  // `workerReadyRef` = hasil aktif sudah ada di worker (untuk selectBg /
  // downloadMask jalur worker).
  const workerReadyRef = useRef(false);
  const navigate = useNavigate();

  // Web Worker jalur PENYAJIAN hasil (komposit + encode PNG) — ganti warna
  // latar / unduh mask pada foto besar tidak membekukan UI (toDataURL full-res
  // terukur 300 ms–1,2 dtk pada 12MP); fallback thread utama bila tanpa
  // Worker / createImageBitmap.
  const useWorker = typeof Worker !== "undefined";
  const bgWorkerClient = useMemo(
    () =>
      createWorkerClient<BgWorkerRequestNoId, BgWorkerResponse>({
        createWorker: () =>
          new Worker(new URL("./bgRemove.worker.ts", import.meta.url), {
            type: "module",
          }),
        errorMessage: "Worker gagal memproses foto.",
      }),
    []
  );

  // Hentikan worker saat komponen dilepas: tolak permintaan tertunda, terminate.
  useEffect(() => {
    return () => bgWorkerClient.terminate();
  }, [bgWorkerClient]);

  /** Blob PNG hasil (dari worker) → kanvas banding + data URL hasil. Blob yang
   *  dikirim worker = HASIL (transparan → kanvas mentah; warna polos → komposit
   *  warna), padanan `resultUrl` jalur fallback. Decode via <img> + drawImage
   *  (universal); base64 via FileReader async; panel banding dibangun dari blob
   *  via `buildShownCanvas` (checkerboard bila transparan) — pola fill O(1),
   *  tanpa encode full-res di thread utama. */
  const applyResultBlob = async (blob: Blob, hex: string | null) => {
    const url = URL.createObjectURL(blob);
    let canvas: HTMLCanvasElement | null = null;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Gagal memuat hasil."));
        im.src = url;
      });
      canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0);
    } finally {
      URL.revokeObjectURL(url);
    }
    // Blob sudah komposit warna (bila hex) — `buildShownCanvas` mengisi warna
    // yang sama lalu menggambar ulang: piksel identik, biaya O(1) fill.
    if (canvas) setCompareCanvas(buildShownCanvas(canvas, hex));
    setResultUrl(await blobToDataUrl(blob));
  };

  /** Kanvas tampilan panel banding: latar polos (`hex`) atau hasil transparan
   *  yang dikomposit di atas pola checkerboard (visualisasi alpha) — pola
   *  `createPattern` sehingga biaya konstan di resolusi berapa pun. */
  const buildShownCanvas = (
    base: HTMLCanvasElement,
    hex: string | null
  ): HTMLCanvasElement => {
    if (hex) return applyBackgroundColor(base, hex);
    const out = document.createElement("canvas");
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext("2d");
    if (!ctx) return base;
    const sq = 16;
    const pat = document.createElement("canvas");
    pat.width = sq * 2;
    pat.height = sq * 2;
    const pctx = pat.getContext("2d");
    if (pctx) {
      pctx.fillStyle = "#ffffff";
      pctx.fillRect(0, 0, sq * 2, sq * 2);
      pctx.fillStyle = "#dddddd";
      pctx.fillRect(0, 0, sq, sq);
      pctx.fillRect(sq, sq, sq, sq);
    }
    const fill = ctx.createPattern(pat, "repeat");
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(base, 0, 0);
    return out;
  };

  const clampErode = (raw: string) => {
    const n = Number(raw);
    if (Number.isNaN(n)) return 0;
    return Math.min(30, Math.max(0, Math.round(n)));
  };

  const handleFile = (file?: File | null) => {
    setError("");
    setWarning("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    const token = ++fileSeqRef.current;
    setFileName(file.name);
    const url = URL.createObjectURL(file);

    const img = new Image();
    img.onload = () => {
      if (token !== fileSeqRef.current) {
        // file lain sudah dipilih — buang URL ini
        URL.revokeObjectURL(url);
        return;
      }
      imgRef.current = img;
      processImage(img, {
        postProcess,
        alphaMatting: matting,
        erodeSize,
      }, () => URL.revokeObjectURL(url));
    };
    img.onerror = () => {
      if (token !== fileSeqRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      // Tidak ada prosesImage yang dijadwalkan — pastikan busy state pulih.
      setError("Gagal membaca gambar.");
      setProcessing(false);
      URL.revokeObjectURL(url);
    };
    img.src = url;
    setOriginalUrl(url);
  };

  /**
   * Jalankan penghapusan latar dengan opsi segmen (pola rembg). Setelah
   * selesai, warna latar yang sedang dipilih diterapkan ulang ke hasil.
   */
  const processImage = (
    image: HTMLImageElement,
    opts: RemoveBgOptions,
    onDone?: () => void
  ) => {
    // Token saat pemanggilan: hasil dibuang bila file yang lebih baru dipilih
    // sebelum proses selesai (hasil file lama tidak menimpa file baru).
    const token = fileSeqRef.current;
    // Jalur worker berjalan async — busy-nya ditutup di `.finally` async,
    // jadi `finally` sinkron di bawah HANYA untuk jalur fallback.
    let workerPath = false;
    setProcessing(true);
    // Beri kesempatan indikator "Memproses…" ter-render dulu.
    setTimeout(async () => {
      try {
        if (token !== fileSeqRef.current) return;
        const { canvas, mask, foregroundRatio } = removeBackground(image, opts);
        if (token !== fileSeqRef.current) return;
        setDims({ w: canvas.width, h: canvas.height });
        const bgOpt = BG_OPTIONS.find((o) => o.id === bgId);
        setWarning(
          foregroundRatio < 0.01
            ? "Seluruh gambar terdeteksi sebagai latar — coba foto dengan subjek yang jelas."
            : foregroundRatio < 0.25
              ? "Subjek terdeteksi kecil. Hasil terbaik untuk foto dengan latar polos (putih/biru/merah)."
              : ""
        );
        // Jalur worker: hasil & mask dikirim sebagai ImageBitmap
        // (createImageBitmap terukur ~0 ms blokir pada 12MP; transfer
        // zero-copy) — komposit + encode PNG berjalan di luar thread utama;
        // busy ditutup setelah blob kembali.
        const canWorker =
          useWorker && typeof createImageBitmap === "function";
        if (canWorker) {
          try {
            const resultBmp = await createImageBitmap(canvas);
            const maskBmp = await createImageBitmap(mask);
            if (token !== fileSeqRef.current) {
              // File lain dipilih saat bitmap dibuat — buang hasil basi.
              resultBmp.close();
              maskBmp.close();
              return;
            }
            workerPath = true;
            transparentRef.current = null;
            maskRef.current = null;
            setStep("result");
            bgWorkerClient
              .post(
                {
                  type: "setResult",
                  result: resultBmp,
                  mask: maskBmp,
                  hex: bgOpt?.hex ?? null,
                },
                [resultBmp, maskBmp]
              )
              .then(async (res) => {
                if (token !== fileSeqRef.current) return;
                if (!res.ok) throw new Error(res.error);
                workerReadyRef.current = true;
                await applyResultBlob(res.blob, bgOpt?.hex ?? null);
              })
              .catch((e) => {
                if (token !== fileSeqRef.current) return;
                setError(
                  e instanceof Error ? e.message : "Gagal memproses gambar."
                );
              })
              .finally(() => {
                if (token === fileSeqRef.current) setProcessing(false);
                onDone?.();
              });
            return;
          } catch {
            // createImageBitmap gagal — jatuh ke jalur fallback thread utama.
          }
        }
        // Fallback thread utama (tanpa Worker / createImageBitmap).
        transparentRef.current = canvas;
        maskRef.current = mask;
        const shown = buildShownCanvas(canvas, bgOpt?.hex ?? null);
        setCompareCanvas(shown);
        // `resultUrl` tetap hasil MENTAH (transparan / warna polos) — dipakai
        // unduh & terusan; kanvas checkerboard hanya untuk panel banding.
        setResultUrl(
          bgOpt?.hex
            ? shown.toDataURL("image/png")
            : canvas.toDataURL("image/png")
        );
        setStep("result");
      } catch (e) {
        if (token !== fileSeqRef.current) return;
        setError(e instanceof Error ? e.message : "Gagal memproses gambar.");
      } finally {
        // Jalur worker sudah return — busy ditutup di `.finally` async-nya.
        if (workerPath) return;
        // Busy state hanya dipulihkan oleh proses TERBARU (proses basi tidak
        // boleh menimpa flag milik file yang sedang berjalan).
        if (token === fileSeqRef.current) setProcessing(false);
        onDone?.();
      }
    }, 60);
  };

  const setPost = (v: boolean) => {
    setPostProcess(v);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess: v, alphaMatting: matting, erodeSize });
  };

  const setMatt = (v: boolean) => {
    setMatting(v);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess, alphaMatting: v, erodeSize });
  };

  const setErode = (n: number) => {
    setErodeSize(n);
    if (imgRef.current)
      processImage(imgRef.current, { postProcess, alphaMatting: matting, erodeSize: n });
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearBgOptions();
    setPostProcess(true);
    setMatting(false);
    setErodeSize(10);
    setLayoutPrefix("bg-");
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** Ganti latar: warna polos atau transparan. Panel banding ikut di-redraw;
   *  unduh/terusan tetap hasil mentah. Jalur worker: komposit + encode PNG di
   *  worker (OffscreenCanvas) — tanpa pembekuan diam-diam; busy ringan tampil.
   *  Fallback: komposit sinkron dari kanvas transparan tersimpan. */
  const selectBg = (opt: BgOption) => {
    setBgId(opt.id);
    if (useWorker && workerReadyRef.current) {
      setBgBusy(true);
      setError("");
      const token = fileSeqRef.current;
      bgWorkerClient
        .post({ type: "recolor", hex: opt.hex })
        .then(async (res) => {
          if (token !== fileSeqRef.current) return;
          if (!res.ok) throw new Error(res.error);
          await applyResultBlob(res.blob, opt.hex);
        })
        .catch((e) => {
          if (token !== fileSeqRef.current) return;
          setError(e instanceof Error ? e.message : "Gagal mengganti latar.");
        })
        .finally(() => {
          if (token === fileSeqRef.current) setBgBusy(false);
        });
      return;
    }
    const canvas = transparentRef.current;
    if (!canvas) return;
    const shown = buildShownCanvas(canvas, opt.hex);
    setCompareCanvas(shown);
    setResultUrl(
      opt.hex ? shown.toDataURL("image/png") : canvas.toDataURL("image/png")
    );
  };

  const download = () => {
    if (!resultUrl) return;
    downloadUrl(resultUrl, `background-removed-${bgId}.png`);
  };

  /** Ekspor mask alpha (padanan rembg `-om / --only-mask`). Jalur worker:
   *  encode mask di worker (OffscreenCanvas) tanpa membekukan UI. */
  const downloadMask = () => {
    const base = fileName.replace(/\.[^.]+$/, "") || "background-removed";
    if (useWorker && workerReadyRef.current) {
      setBgBusy(true);
      bgWorkerClient
        .post({ type: "mask" })
        .then((res) => {
          if (!res.ok) throw new Error(res.error);
          downloadUrl(URL.createObjectURL(res.blob), `${base}-mask.png`);
        })
        .catch((e) =>
          setError(
            e instanceof Error ? e.message : "Gagal mengekspor mask."
          )
        )
        .finally(() => setBgBusy(false));
      return;
    }
    const mask = maskRef.current;
    if (!mask) return;
    downloadUrl(mask.toDataURL("image/png"), `${base}-mask.png`);
  };

  /** Teruskan hasil (dengan warna latar terpilih) ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = () => {
    if (!resultUrl) return;
    setPendingPasFoto(resultUrl);
    navigate("/photo-studio/pas-foto-3x4");
  };

  /** Kirim hasil (dengan warna latar terpilih) ke Auto Layout untuk lembar A4. */
  const forwardToLayout = () => {
    if (!resultUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "background-removed";
    setPendingLayoutPhoto(resultUrl, `${layoutPrefix}${base}`);
    navigate("/ai-assistant/auto-layout");
  };

  return (
    <div className="bg-removal-page">
      <header className="module-header">
        <span className="module-icon">✂️</span>
        <div>
          <h1>Background Removal</h1>
          <p>
            Hapus latar belakang secara otomatis (heuristik warna kulit +
            flood fill dari tepi) lalu ganti dengan warna polos atau biarkan
            transparan.
          </p>
        </div>
      </header>

      {step === "upload" && (
        <section className="panel">
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
            💡 Cara kerja: warna latar diambil dari tepi gambar, lalu dihapus
            dengan penyebaran (flood fill) yang berhenti di kulit dan warna
            yang jauh dari latar. Paling akurat untuk latar polos — standar
            foto paspor / visa.
          </p>
        </section>
      )}

      {processing && (
        <section className="panel">
          <div className="processing-row">
            <span className="spinner" />
            <span>Memproses latar belakang…</span>
          </div>
        </section>
      )}

      {step === "result" && resultUrl && originalUrl && (
        <div className="result">
          <SyncedPhotoCompare
            before={{ label: "Sebelum (asli)", src: originalUrl }}
            after={{
              label: `Sesudah ${
                bgId === "transparent"
                  ? "(latar transparan)"
                  : `(latar ${
                      BG_OPTIONS.find((o) => o.id === bgId)?.name.toLowerCase() ??
                      "warna"
                    })`
              }`,
              canvas: compareCanvas,
            }}
          />

          <section className="panel">
            <div className="file-row">
              <span>
                🖼️ Foto: <strong>{fileName}</strong>
                {dims && (
                  <span className="dims">
                    {" "}
                    — {dims.w} × {dims.h} px
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setStep("upload");
                  setResultUrl(null);
                  setCompareCanvas(null);
                  setOriginalUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  transparentRef.current = null;
                  maskRef.current = null;
                  workerReadyRef.current = false;
                  imgRef.current = null;
                  setBgId("transparent");
                  setPostProcess(true);
                  setMatting(false);
                  setErodeSize(10);
                }}
              >
                🔄 Foto Lain
              </button>
            </div>

            <span className="preset-label">Latar pengganti</span>
            <div className="bg-options">
              {BG_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={o.id === bgId ? "chip active" : "chip"}
                  disabled={bgBusy}
                  onClick={() => selectBg(o)}
                >
                  <span
                    className={
                      o.hex
                        ? "swatch"
                        : "swatch swatch-checker"
                    }
                    style={o.hex ? { background: o.hex } : undefined}
                  />
                  {o.name}
                </button>
              ))}
            </div>
            {bgBusy && (
              <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
                ⏳ Mengganti latar / menyiapkan mask… (encode di Web Worker —
                UI tetap responsif)
              </p>
            )}

            {warning && <p className="error">{warning}</p>}

            <div className="seg-options">
              <span className="preset-label seg-label">Opsi segmen (pola rembg)</span>
              <ResetPreferencesButton
                title="Hapus opsi segmen & awalan label tersimpan modul ini"
                onReset={handleResetPrefs}
              />
            </div>
            <div className="seg-options">
              <label className="repeat-toggle">
                <input
                  type="checkbox"
                  checked={postProcess}
                  onChange={(e) => setPost(e.target.checked)}
                />
                Post-proses mask
              </label>
              <label className="repeat-toggle">
                <input
                  type="checkbox"
                  checked={matting}
                  onChange={(e) => setMatt(e.target.checked)}
                />
                Alpha matting (tepi halus)
              </label>
              {matting && (
                <label className="seg-erode">
                  Erosi tepi (px)
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={erodeSize}
                    onChange={(e) => setErode(clampErode(e.target.value))}
                  />
                </label>
              )}
            </div>
            <p className="hint">
              💡 <code>--post-process-mask</code>: opening morfologi untuk
              membersihkan bintik &amp; merapikan tepi mask.{" "}
              <code>-a / --alpha-matting-erode-size</code>: mask subjek di-erosi
              sebelum feathering sehingga tepi lebih lembut (default rembg: 10).
            </p>

            <label className="layout-prefix">
              🧩 Awalan label di lembar Auto Layout
              <input
                type="text"
                value={layoutPrefix}
                placeholder="mis. bg-"
                onChange={(e) => setLayoutPrefix(e.target.value)}
              />
            </label>

            <div className="result-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={forwardToPasFoto}
              >
                🪪 Jadikan Pas Foto 3x4
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={forwardToLayout}
              >
                🧩 Susun ke Lembar A4
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={download}
              >
                ⬇️ Unduh PNG
              </button>
              <button
                type="button"
                className="btn"
                onClick={downloadMask}
                title="Ekspor mask alpha (putih = subjek), padanan rembg --only-mask"
              >
                ⬇️ Unduh Mask
              </button>
            </div>
            <p className="hint">
              💡 PNG mempertahankan transparansi. Untuk cetak pas foto, pilih
              latar Putih/Biru/Merah sesuai ketentuan, lalu gunakan modul Photo
              Studio untuk crop &amp; template A4.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
