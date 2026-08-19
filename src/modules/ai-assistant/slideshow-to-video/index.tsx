import { useCallback, useEffect, useRef, useState } from "react";
import {
  recordWithAudio,
  type AudioRecorder,
  type RecordWithAudioAudio,
} from "../../shared/recordWithAudio";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import { downloadUrl } from "../../shared/downloadUrl";
import {
  createSharedAudioState,
  decodeAudioBuffer,
  resolveSharedAudioBuffer,
  type SharedAudioState,
} from "../../shared/audioShared";
import {
  coverFit,
  frameAt,
  totalDuration,
  SLIDESHOW_FPS,
  SLIDESHOW_RES,
} from "./slideshow";
import {
  clearSlideshowOptions,
  DEFAULT_SLIDESHOW_PREFS,
  loadSlideshowPrefs,
  saveSlideshowPrefs,
  type SlideshowPrefs,
} from "./optionsStorage";
import "./style.css";

/** Muat file gambar (blob URL) menjadi elemen <img> siap digambar. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("gagal memuat gambar"));
    img.src = url;
  });
}

/** Tipe generik untuk objek yang bisa di-draw ke canvas (HTMLImageElement atau ImageBitmap). */
interface Drawble {
  readonly width: number;
  readonly height: number;
}

function isDrawble(v: unknown): v is Drawble {
  return (
    typeof v === "object" &&
    v !== null &&
    "width" in v &&
    "height" in v
  );
}

/** Context audio dibuat dalam gestur klik (autoplay dengan suara diizinkan). */
function makeAudioContext(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

/** Timecode singkat `m:ss.d` untuk pratinjau & progress rekaman. */
export function fmtTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${m}:${String(s).padStart(2, "0")}.${d}`;
}

/** Format byte untuk indikator progres rekaman live (mis. "1.2 MB"). */
export function fmtBytes(b: number): string {
  if (!Number.isFinite(b) || b < 0) return "0 B";
  if (b < 1024) return `${b} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const PREVIEW_W = 960;
const PREVIEW_H = 540;

export default function SlideshowToVideoPage() {
  const [prefs, setPrefs] = useState<SlideshowPrefs>(() => loadSlideshowPrefs());
  const [photos, setPhotos] = useState<HTMLImageElement[]>([]);
  const [music, setMusic] = useState<{
    name: string;
    buffer: ArrayBuffer | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // Musik latar ikut diputar saat pratinjau (toggle) — instance buffer yang
  // sama dengan yang dipakai rekaman (decode sekali, lihat audioShared.ts).
  const [musicOnPreview, setMusicOnPreview] = useState(true);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recBytes, setRecBytes] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  // Pra-render: ImageBitmap[] sebelum rekaman dimulai — setiap drawImage
  // dari ImageBitmap lebih cepat dari HTMLImageElement karena pixel sudah
  // ter-decode di memori (tidak re-decode saat draw).
  const [prerendering, setPrerendering] = useState(false);
  const [prerenderProgress, setPrerenderProgress] = useState(0);
  const prerenderedRef = useRef<ImageBitmap[] | null>(null);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // State bersama AudioBuffer musik (buffer + promise) — decode SEKALI,
  // pratinjau & rekaman memakai instance yang sama (pola resolveSharedAudioBuffer).
  const musicAudioRef = useRef<SharedAudioState>(createSharedAudioState());
  // BufferSource musik saat pratinjau (dihentikan saat jeda/ganti musik).
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number>(0);
  const cancelledRef = useRef(false);
  const playStartRef = useRef(0);
  const resultUrlRef = useRef<string | null>(null);

  const duration = totalDuration(photos.length, prefs.slideDur);
  const res =
    SLIDESHOW_RES.find((r) => r.id === prefs.resId) ?? SLIDESHOW_RES[0];

  // --- Gambar satu frame slideshow (cover-fit + fade tumpang-tindih) ---
  // Satu fungsi untuk pratinjau DAN rekaman → kedua jalur identik.
  // `slides` boleh HTMLImageElement[] (pratinjau) ATAU ImageBitmap[] (rekaman
  // dengan pra-render) — keduanya punya naturalWidth/naturalHeight + bisa
  // di-draw via ctx.drawImage.
  const drawFrame = useCallback(
    (canvas: HTMLCanvasElement | null, t: number, slides: readonly Drawble[]) => {
      if (!canvas || slides.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      const fr = frameAt(t, slides.length, prefs.slideDur, prefs.fadeDur);
      const img = slides[fr.index];
      if (!img || !isDrawble(img) || !img.width) return;
      const r = coverFit(img.width, img.height, w, h);
      ctx.drawImage(img as CanvasImageSource, r.dx, r.dy, r.dw, r.dh);
      if (fr.next != null && fr.fade > 0 && slides[fr.next]) {
        const nxt = slides[fr.next];
        if (!isDrawble(nxt)) return;
        const nr = coverFit(nxt.width, nxt.height, w, h);
        ctx.globalAlpha = fr.fade;
        ctx.drawImage(nxt as CanvasImageSource, nr.dx, nr.dy, nr.dw, nr.dh);
        ctx.globalAlpha = 1;
      }
    },
    [prefs.slideDur, prefs.fadeDur]
  );

  /** Decode musik latar SEKALI (via OfflineAudioContext, tanpa gestur) — hasil
   *  di-cache di `musicAudioRef`; pratinjau & rekaman menerima instance yang
   *  sama persis (pola resolveSharedAudioBuffer). */
  const ensureMusicBuffer = async (): Promise<AudioBuffer | null> => {
    const m = music;
    if (!m || !m.buffer) return null;
    const raw = m.buffer;
    return resolveSharedAudioBuffer(musicAudioRef.current, async () => {
      try {
        return await decodeAudioBuffer(raw.slice(0));
      } catch {
        return null;
      }
    });
  };

  /** Mulai musik latar untuk PRATINJAU (BufferSource loop → destination). */
  const startPreviewMusic = async () => {
    if (!music || !musicOnPreview) return;
    const buf = await ensureMusicBuffer();
    if (!buf) return;
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = makeAudioContext();
      audioCtxRef.current = ctx;
    }
    if (!ctx) return;
    await ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    musicSourceRef.current = src;
  };

  const stopPreviewMusic = () => {
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.stop();
      } catch {
        // sudah berhenti — abaikan
      }
      musicSourceRef.current = null;
    }
  };

  const stopPreview = () => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    stopPreviewMusic();
    setPlaying(false);
  };

  const startPreview = async () => {
    if (photos.length === 0) return;
    setError("");
    stopPreview();
    // Musik latar (bila aktif): decode sekali lalu mulai loop — instance
    // buffer yang sama dengan yang dipakai rekaman nanti.
    if (music && musicOnPreview) {
      await startPreviewMusic();
    }
    playStartRef.current = performance.now();
    setPlaying(true);
    const loop = () => {
      try {
        const total = totalDuration(photos.length, prefs.slideDur);
        const t = (performance.now() - playStartRef.current) / 1000;
        const tt = total > 0 ? t % total : 0;
        drawFrame(previewRef.current, tt, photos);
        if (timeRef.current) {
          timeRef.current.textContent = fmtTime(Math.min(t, total));
        }
        rafRef.current = requestAnimationFrame(loop);
      } catch (e) {
        // Satu frame gagal (mis. foto korup / drawImage throw) — JANGAN biarkan
        // loop rAF mati diam-diam: tampilkan pesan, hentikan pratinjau dengan
        // bersih (rAF dibatalkan, musik dihentikan, state playing di-reset)
        // sehingga pengguna bisa memperbaiki (ganti foto) dan memutar lagi.
        setError(
          e instanceof Error
            ? `Pratinjau gagal: ${e.message}`
            : "Pratinjau gagal — kesalahan saat menggambar frame."
        );
        stopPreview();
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  };

  /** Toggle musik saat pratinjau (tanpa menghentikan pratinjau berjalan). */
  const togglePreviewMusic = () => {
    const next = !musicOnPreview;
    setMusicOnPreview(next);
    if (playing) {
      if (next) void startPreviewMusic();
      else stopPreviewMusic();
    }
  };

  // Pembersihan saat unmount: hentikan rAF, batal rekaman, revoke URL hasil,
  // tutup AudioContext (tidak ada pemutaran yang bocor antar halaman).
  useEffect(() => {
    resultUrlRef.current = resultUrl;
  }, [resultUrl]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelledRef.current = true;
      stopPreviewMusic();
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      if (prerenderedRef.current) {
        prerenderedRef.current.forEach((b) => b.close());
        prerenderedRef.current = null;
      }
      void audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, []);

  useEffect(() => {
    saveSlideshowPrefs(prefs);
  }, [prefs]);

  // --- Upload ---
  const handlePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    const imgs: HTMLImageElement[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const url = URL.createObjectURL(f);
        const img = await loadImage(url);
        imgs.push(img);
      } catch {
        // file rusak — lewati
      }
    }
    if (imgs.length === 0) {
      setError("Tidak ada file gambar yang valid (JPG, PNG, atau WebP).");
      return;
    }
    // Revoke URL blob foto lama (sudah tidak dipakai setelah diganti).
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.src));
      return imgs;
    });
  };

  const handleMusic = async (f: File | null) => {
    if (!f) return;
    const ok =
      f.type.startsWith("audio/") ||
      /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(f.name);
    if (!ok) {
      setError("File musik harus berupa audio (MP3, WAV, OGG, M4A, …).");
      return;
    }
    try {
      const buf = await f.arrayBuffer();
      stopPreviewMusic();
      // Musik baru → objek state DIGANTI: decode yang masih berjalan menulis
      // ke objek lama, tidak bocor ke musik berikutnya.
      musicAudioRef.current = createSharedAudioState();
      setMusic({ name: f.name, buffer: buf });
      setError(null);
    } catch {
      setError("Gagal membaca file musik.");
    }
  };

  const clearPhotos = () => {
    stopPreview();
    setPhotos((prev) => {
      prev.forEach((p) => URL.revokeObjectURL(p.src));
      return [];
    });
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const clearAll = () => {
    clearPhotos();
    setMusic(null);
  };

  // --- Rekaman (real-time, WebM via recordWithAudio + musik latar loop) ---
  const finishRecord = useCallback(async (rec: AudioRecorder) => {
    // Bersihkan ImageBitmap pra-render setelah rekaman selesai.
    if (prerenderedRef.current) {
      prerenderedRef.current.forEach((b) => b.close());
      prerenderedRef.current = null;
    }
    let blob: Blob | null = null;
    try {
      blob = await rec.stop();
    } catch {
      blob = null;
    }
    setRecording(false);
    setProgress(0);
    setRecBytes(0);
    if (cancelledRef.current || !blob || blob.size === 0) {
      if (!cancelledRef.current) setError("Rekaman gagal — hasil kosong.");
      return;
    }
    const url = URL.createObjectURL(blob);
    setResultUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const startRecord = async () => {
    if (photos.length === 0 || recording) return;
    setError(null);
    stopPreview();

    // --- Fase 1: Pra-render semua foto sebagai ImageBitmap ---
    // Setiap drawImage dari ImageBitmap lebih cepat dari HTMLImageElement
    // karena pixel sudah ter-decode di memori (tidak re-decode saat draw).
    // Ini mencegah UI beku untuk batch foto besar selama rekaman real-time.
    setPrerendering(true);
    setPrerenderProgress(0);
    const bitmaps: ImageBitmap[] = [];
    try {
      for (let i = 0; i < photos.length; i++) {
        if (cancelledRef.current) {
          setPrerendering(false);
          return;
        }
        const bmp = await createImageBitmap(photos[i]);
        bitmaps.push(bmp);
        setPrerenderProgress((i + 1) / photos.length);
      }
      prerenderedRef.current = bitmaps;
    } catch (e) {
      // Gagal pra-render — cleanup dan jatuh ke HTMLImageElement
      bitmaps.forEach((b) => b.close());
      prerenderedRef.current = null;
      setPrerendering(false);
      setError(
        e instanceof Error
          ? `Gagal memuat foto: ${e.message}`
          : "Gagal memuat foto untuk rekaman."
      );
      return;
    }
    setPrerendering(false);

    const canvas = document.createElement("canvas");
    canvas.width = res.width;
    canvas.height = res.height;
    if (!("captureStream" in canvas)) {
      setError("Browser tidak mendukung perekaman canvas (captureStream).");
      return;
    }
    if (!canvas.getContext("2d")) {
      setError("Canvas 2D tidak tersedia.");
      return;
    }

    // Musik latar (opsional): AudioBuffer → loop → MediaStreamDestination.
    // Buffer = instance yang sama dengan yang dipakai pratinjau (decode sekali).
    let audio: RecordWithAudioAudio | null = null;
    if (music) {
      try {
        let ctx = audioCtxRef.current;
        if (!ctx) {
          ctx = makeAudioContext();
          audioCtxRef.current = ctx;
        }
        if (ctx) {
          await ctx.resume();
          const buffer = await ensureMusicBuffer();
          if (buffer) {
            audio = { context: ctx, buffer, loop: true };
          }
        }
      } catch {
        // gagal — rekam tanpa musik
      }
    }

    const rec = recordWithAudio({
      canvas,
      fps: prefs.fps,
      mimeType: "video/webm",
      audio,
      videoBitsPerSecond: 12_000_000,
      // Progres live: byte yang terkumpul dari MediaRecorder (tiap ~250 ms)
      // → indikator ukuran di samping persen/waktu saat merekam.
      onProgress: (p) => setRecBytes(p.bytes),
    });

    cancelledRef.current = false;
    setRecording(true);
    setProgress(0);
    setRecBytes(0);
    const slides: readonly Drawble[] = (prerenderedRef.current as Drawble[] | null) ?? photos;
    const total = totalDuration(photos.length, prefs.slideDur);
    const start = performance.now();
    let lastProgressUpdate = 0;
    const tick = () => {
      try {
        const t = (performance.now() - start) / 1000;
        const target = Math.min(total, t);
        drawFrame(canvas, target, slides);
        drawFrame(previewRef.current, target, slides); // umpan balik live di pratinjau
        if (timeRef.current) timeRef.current.textContent = fmtTime(target);
        const p = total > 0 ? target / total : 1;
        if (performance.now() - lastProgressUpdate > 120 || p >= 1) {
          lastProgressUpdate = performance.now();
          setProgress(p);
        }
        if (target < total && !cancelledRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          void finishRecord(rec);
        }
      } catch (e) {
        // Satu frame gagal (mis. foto korup / drawImage throw) — JANGAN biarkan
        // loop rAF mati diam-diam: tampilkan error, putus loop, dan jalankan
        // jalur cleanup yang SAMA dengan selesai/batal (stop recorder, buang
        // hasil parsial, reset busy/progress/bytes) agar rekaman tidak macet
        // permanen dan tombol Hentikan/ulang selalu berfungsi.
        cancelledRef.current = true;
        setError(
          e instanceof Error
            ? `Rekaman gagal: ${e.message}`
            : "Rekaman gagal — kesalahan saat memproses frame."
        );
        stopPreviewMusic();
        void finishRecord(rec);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const cancelRecord = () => {
    cancelledRef.current = true;
  };

  const handleResetPrefs = () => {
    clearSlideshowOptions();
    setPrefs({ ...DEFAULT_SLIDESHOW_PREFS });
  };

  const setNum = (key: "slideDur" | "fadeDur") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) setPrefs((p) => ({ ...p, [key]: v }));
  };

  return (
    <div className="slideshow-page">
      <header className="module-header">
        <span className="module-icon">🎞️</span>
        <div>
          <h1>Slideshow to Video</h1>
          <p>
            Susun beberapa foto menjadi video <code>WebM</code> dengan transisi
            fade — musik latar opsional diputar ulang via{" "}
            <code>recordWithAudio</code> (BufferSource → MediaStreamDestination),
            semua proses lokal di browser.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="upload-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => photoInputRef.current?.click()}
          >
            📷 Pilih Foto
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void handlePhotos(e.target.files);
              e.target.value = "";
            }}
          />
          {photos.length > 0 && (
            <button type="button" className="btn" onClick={clearPhotos}>
              🔄 Foto Lain
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => musicInputRef.current?.click()}
          >
            🎵 Musik Latar
          </button>
          <input
            ref={musicInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            hidden
            onChange={(e) => {
              void handleMusic(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {music && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopPreviewMusic();
                musicAudioRef.current = createSharedAudioState();
                setMusic(null);
              }}
            >
              Hapus Musik
            </button>
          )}
        </div>

        {photos.length > 0 && (
          <div className="slideshow-strip">
            {photos.map((p, i) => (
              <div className="slideshow-thumb" key={i}>
                <img src={p.src} alt={`Foto ${i + 1}`} />
                <span className="idx">{i + 1}</span>
              </div>
            ))}
          </div>
        )}

        {music && (
          <div className="slideshow-music">
            🎵 <strong>{music.name}</strong> — diputar berulang sebagai latar
            (pratinjau & rekaman), decode sekali
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {photos.length === 0 && (
          <p className="hint">
            💡 Pilih minimal satu foto (urutan strip = urutan slide). Musik
            latar opsional — tanpa musik, hasil tetap direkam (senyap).
          </p>
        )}
      </section>

      {photos.length > 0 && (
        <>
          <section className="panel">
            <div className="slideshow-options">
              <label>
                Durasi per slide (dtk)
                <input
                  type="number"
                  min={1}
                  max={30}
                  step={0.5}
                  value={prefs.slideDur}
                  onChange={setNum("slideDur")}
                />
              </label>
              <label>
                Transisi fade (dtk)
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.25}
                  value={prefs.fadeDur}
                  onChange={setNum("fadeDur")}
                />
              </label>
              <label>
                FPS output
                <select
                  value={prefs.fps}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      fps: Number(e.target.value) as SlideshowPrefs["fps"],
                    }))
                  }
                >
                  {SLIDESHOW_FPS.map((f) => (
                    <option key={f} value={f}>
                      {f} fps
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Resolusi
                <select
                  value={prefs.resId}
                  onChange={(e) =>
                    setPrefs((p) => ({ ...p, resId: e.target.value }))
                  }
                >
                  {SLIDESHOW_RES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="slideshow-preview-wrap">
              <canvas
                ref={previewRef}
                width={PREVIEW_W}
                height={PREVIEW_H}
                className="slideshow-preview"
              />
              <span className="slideshow-timecode" ref={timeRef}>
                0:00.0
              </span>
            </div>

            <div className="slideshow-controls">
              <button
                type="button"
                className="btn"
                disabled={recording}
                onClick={playing ? stopPreview : () => void startPreview()}
              >
                {playing ? "⏸ Jeda" : "▶️ Putar Pratinjau"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={recording || !music}
                title={
                  music
                    ? "Putar musik latar saat pratinjau (buffer sama dengan rekaman)"
                    : "Pilih musik latar dulu"
                }
                onClick={togglePreviewMusic}
              >
                {musicOnPreview ? "🔊 Musik" : "🔇 Musik Mati"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={recording || prerendering}
                onClick={() => void startRecord()}
              >
                {prerendering
                  ? `⏳ Memuat foto… ${Math.round(prerenderProgress * 100)}%`
                  : recording
                    ? "⏳ Merekam…"
                    : "🎬 Rekam Video"}
              </button>
              {recording && (
                <button type="button" className="btn" onClick={cancelRecord}>
                  ⏹ Hentikan
                </button>
              )}
            </div>

            {recording && (
              <div className="slideshow-progress">
                <div className="slideshow-progress-bar">
                  <div
                    className="slideshow-progress-fill"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
                <span>
                  {Math.round(progress * 100)}% ({fmtTime(progress * duration)}{" "}
                  / {fmtTime(duration)})
                  {recBytes > 0 && <span className="slideshow-rec-bytes"> · {fmtBytes(recBytes)}</span>}
                </span>
              </div>
            )}

            {resultUrl && (
              <div className="slideshow-result">
                <video src={resultUrl} controls loop />
                <div className="slideshow-controls">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      downloadUrl(resultUrl, "slideshow.webm", { revoke: false })
                    }
                  >
                    ⬇️ Unduh WebM
                  </button>
                  <button type="button" className="btn" onClick={clearAll}>
                    🔄 Video Lain
                  </button>
                </div>
              </div>
            )}
          </section>

          <div className="prefs-row">
            <ResetPreferencesButton
              title="Hapus pengaturan tersimpan modul ini (durasi slide, fade, FPS, resolusi)"
              onReset={handleResetPrefs}
            />
          </div>
        </>
      )}
    </div>
  );
}
