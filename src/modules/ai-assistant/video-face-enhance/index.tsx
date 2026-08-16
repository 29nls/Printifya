import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { setPendingPasFoto } from "../../shared/pasFotoBridge";
import { setPendingLayoutPhoto } from "../../shared/autoLayoutBridge";
import { downloadUrl } from "../../shared/downloadUrl";
import { DEFAULT_VIDEO_PARAMS, type VideoEnhanceParams } from "./videoEnhance";
import { useWaveformAudio } from "./useWaveformAudio";
import { useSyncCompare } from "./useSyncCompare";
import { useVideoEnhanceRun, type VideoMeta } from "./useVideoEnhanceRun";
import { UploadZone, FileInfoBar } from "./VideoFileBar";
import { EnhanceControls } from "./VideoControls";
import { ResultCompare } from "./ResultCompare";
import {
  clearVideoOptions,
  loadVideoPrefs,
  saveVideoPrefs,
} from "./optionsStorage";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import "../../photo-studio/shared/style.css";
import "./style.css";

export default function VideoFaceEnhancePage() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // Semua opsi pipeline + awalan label — default dari localStorage (divalidasi).
  const [params, setParams] = useState<VideoEnhanceParams>(
    () => loadVideoPrefs().params
  );
  const [layoutPrefix, setLayoutPrefix] = useState(
    () => loadVideoPrefs().layoutPrefix
  );
  // null = belum diketahui, true/false = video sumber punya/tanpa audio.
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const wave = useWaveformAudio(videoUrl, hasAudio);
  const runCtl = useVideoEnhanceRun({
    meta,
    params,
    hasAudio,
    videoRef,
    audioCtxRef: wave.audioCtxRef,
    audioSharedRef: wave.audioSharedRef,
    ensureAudioBuffer: wave.ensureAudioBuffer,
    setError,
  });
  const sync = useSyncCompare(runCtl.resultUrl);

  // Persist semua opsi + awalan setiap berubah.
  useEffect(() => {
    saveVideoPrefs({ params, layoutPrefix });
  }, [params, layoutPrefix]);

  // URL sumber terbaru — dibaca saat unmount (cleanup di bawah), agar revoke
  // hanya terjadi saat komponen benar-benar dilepas, BUKAN saat videoUrl
  // berubah (cleanup lama ikut me-revoke blob sumber setiap kali hasil baru
  // dibuat — membuat run berikutnya kehilangan audio). Cleanup hasil/recorder/
  // worker dimiliki useVideoEnhanceRun; cleanup audio & sinkronisasi banding
  // dimiliki useWaveformAudio / useSyncCompare (ikut jalan saat unmount).
  const videoUrlRef = useRef(videoUrl);
  videoUrlRef.current = videoUrl;
  useEffect(() => {
    return () => {
      const vUrl = videoUrlRef.current;
      if (vUrl) URL.revokeObjectURL(vUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("File harus berupa video (MP4, WebM, atau format video lain).");
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    const token = ++runCtl.fileTokenRef.current;
    video.onerror = () => {
      if (token !== runCtl.fileTokenRef.current) return;
      setError("Gagal membaca video.");
      URL.revokeObjectURL(url);
    };
    // Durasi WebM buatan MediaRecorder kadang baru terbaca belakangan
    // (Infinity saat loadedmetadata → finite setelah durationchange), jadi
    // polling hingga durasi valid sebelum lanjut sambil mendengarkan event
    // `durationchange` (selain `loadedmetadata`) agar durasi yang baru
    // terfinalisasi langsung terdeteksi tanpa menunggu jadwal poll berikutnya.
    // Batas ~10 dtk (200 × 50 ms) memberi waktu browser menulis/membaca durasi
    // container — blob WebM captureStream sering butuh lebih dari 3 dtk.
    const waitForDuration = (): Promise<number> =>
      new Promise((resolve) => {
        let settled = false;
        let pending = false;
        const t0 = performance.now();
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", check);
          video.removeEventListener("durationchange", check);
        };
        const finish = (d: number) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(d);
        };
        // Rantai poll TUNGGAL (satu setTimeout aktif) + batas waktu dinding
        // ~10 dtk: event loadedmetadata/durationchange memicu check lebih awal
        // (deteksi instan), tapi tidak memulai rantai paralel — jadi batas
        // waktu selalu tepat 10 dtk terlepas dari berapa kali event menyala.
        const schedule = () => {
          if (pending) return;
          pending = true;
          setTimeout(() => {
            pending = false;
            check();
          }, 50);
        };
        const check = () => {
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            finish(d);
            return;
          }
          if (performance.now() - t0 > 10_000) {
            finish(0);
            return;
          }
          schedule();
        };
        video.addEventListener("loadedmetadata", check);
        video.addEventListener("durationchange", check);
        check();
      });
    video.src = url;
    video.load();
    void waitForDuration().then((duration) => {
      if (token !== runCtl.fileTokenRef.current) {
        // file lain sudah dipilih — buang URL ini
        URL.revokeObjectURL(url);
        return;
      }
      if (duration <= 0) {
        setError("Durasi video tidak terbaca — coba format MP4/WebM.");
        URL.revokeObjectURL(url);
        return;
      }
      // Deteksi track audio: audioTracks (Safari/Edge), mozHasAudio (Firefox),
      // dan fallback captureStream() (Chrome tidak memaparkan audioTracks).
      const videoWithAudio = video as HTMLVideoElement & {
        audioTracks?: { length: number };
        mozHasAudio?: boolean;
        captureStream?: () => MediaStream;
      };
      let hasAudioTrack =
        (videoWithAudio.audioTracks?.length ?? 0) > 0 ||
        videoWithAudio.mozHasAudio === true;
      if (!hasAudioTrack && typeof videoWithAudio.captureStream === "function") {
        try {
          const s = videoWithAudio.captureStream();
          hasAudioTrack = s.getAudioTracks().length > 0;
          s.getTracks().forEach((t) => t.stop());
        } catch {
          // anggap tanpa audio
        }
      }
      setHasAudio(hasAudioTrack);
      setMeta({ w: video.videoWidth, h: video.videoHeight, duration });
      // Video baru → audio buffer/promise lama TIDAK berlaku (jangan diputar
      // ulang untuk video lain) — indikator waveform ikut di-reset dan akan
      // di-decode ulang oleh efek [videoUrl, hasAudio].
      wave.resetAudioForNewVideo();
      setVideoUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      runCtl.clearResult();
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  /** "🔄 Video Lain": buang video + hasil + audio, kembali ke upload zone. */
  const handleResetVideo = () => {
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setMeta(null);
    setError("");
    setHasAudio(null);
    wave.resetAudioForNewVideo();
    runCtl.clearResult();
  };

  const resetParams = () => {
    setParams({ ...DEFAULT_VIDEO_PARAMS });
  };

  /** Reset preferensi tersimpan ke default; state ikut dipulihkan. */
  const handleResetPrefs = () => {
    clearVideoOptions();
    setParams({ ...DEFAULT_VIDEO_PARAMS });
    setLayoutPrefix("video-");
  };

  /** Ambil frame video hasil saat ini (posisi pemutaran pengguna) → data URL. */
  const captureResultFrame = (): Promise<string> => {
    const v = sync.resVideoRef.current;
    if (!v) return Promise.reject(new Error("Video hasil belum siap."));
    if (v.videoWidth === 0 || v.videoHeight === 0) {
      return Promise.reject(
        new Error("Frame video hasil belum tersaji — putar video dulu.")
      );
    }
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.reject(new Error("Canvas 2D tidak tersedia."));
    ctx.drawImage(v, 0, 0);
    return Promise.resolve(canvas.toDataURL("image/png"));
  };

  /** Teruskan frame hasil ke alur crop Pas Foto 3x4. */
  const forwardToPasFoto = async () => {
    setError("");
    try {
      const dataUrl = await captureResultFrame();
      setPendingPasFoto(dataUrl);
      navigate("/photo-studio/pas-foto-3x4");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil frame hasil.");
    }
  };

  /** Kirim frame hasil ke Auto Layout (label memakai awalan modul ini). */
  const forwardToLayout = async () => {
    setError("");
    try {
      const dataUrl = await captureResultFrame();
      const base = fileName.replace(/\.[^.]+$/, "") || "video-face";
      setPendingLayoutPhoto(dataUrl, `${layoutPrefix}${base}`);
      navigate("/ai-assistant/auto-layout");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengambil frame hasil.");
    }
  };

  const download = () => {
    if (!runCtl.resultUrl) return;
    const base = fileName.replace(/\.[^.]+$/, "") || "video-face";
    downloadUrl(
      runCtl.resultUrl,
      `${base}-face-restored.${runCtl.resultExt}`,
      { revoke: false }
    );
  };

  return (
    <div className="video-enhance-page">
      {/* Video sumber tersembunyi — dipakai untuk seek & drawImage frame. */}
      <video
        ref={videoRef}
        src={videoUrl ?? undefined}
        muted
        playsInline
        preload="auto"
        className="vfe-source"
      />
      <header className="module-header">
        <span className="module-icon">🎥</span>
        <div>
          <h1>Video Face Enhance</h1>
          <p>
            Pulihkan kualitas wajah pada video ala{" "}
            <code>kepengxu/PGTFormer</code> (IJCAI'24): tiap frame dianalisis
            (deteksi wajah per frame — parsing-guided), wajah dipulihkan lebih
            kuat dari latar, lalu hasil di-blend dengan frame sebelumnya untuk{" "}
            <strong>koherensi temporal tanpa pre-alignment</strong> — mengurangi
            kedipan antar frame. Output direkam sebagai video WebM/MP4 di
            browser. Tanpa model ML, semua proses lokal.
          </p>
        </div>
      </header>

      {!videoUrl && (
        <UploadZone
          dragOver={dragOver}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onFile={handleFile}
          error={error}
        />
      )}

      {videoUrl && meta && (
        <>
          <section className="panel">
            <FileInfoBar
              fileName={fileName}
              meta={meta}
              hasAudio={hasAudio}
              wave={wave}
              onResetVideo={handleResetVideo}
            />

            <EnhanceControls
              params={params}
              onParamsChange={setParams}
              processing={runCtl.processing}
              progress={runCtl.progress}
              onRun={runCtl.run}
              onCancel={runCtl.cancel}
              onReset={resetParams}
              mp4Supported={runCtl.mp4Supported}
              effFormat={runCtl.effFormat}
            />
            <p className="hint">
              💡 PGTFormer beroperasi di resolusi 512 — pilih "512 px (PGTFormer)"
              untuk perilaku paling dekat dengan repo asli; 720 px/Asli
              menghasilkan video lebih tajam tapi lebih lambat. Frame yang
              diproses = durasi × FPS; turunkan FPS untuk video panjang.
              **Sampling frame** memproses setengah/sepertiga frame untuk video
              panjang (2×/3× lebih cepat): tiap frame hasil ditahan beberapa
              slot output, jadi durasi & FPS hasil tetap sama — hanya kehalusan
              gerak berkurang. Durasi hasil ≈ durasi sumber (frame diproses
              dulu, lalu direkam ulang pada jadwal FPS); untuk video sangat
              panjang perekaman berjalan langsung dan durasi bisa sedikit lebih
              panjang. Track audio sumber dipertahankan: audio di-decode sekali
              menjadi AudioBuffer lalu diputar ulang via WebAudio →
              MediaStreamDestination saat rekam — output tidak senyap bila video
              sumber punya suara. Mini waveform di samping badge 🔊 menunjukkan
              audio benar-benar terbaca (hasil decode); **klik waveform untuk
              memutar/jeda audio sumber** (cek cepat, tanpa membuka pemutar
              penuh — diputar via WebAudio, elemen video tidak disentuh); bila
              muncul "⚠️ audio tak terbaca", hasil direkam tanpa suara.
            </p>
          </section>

          <section className="panel">
            <div className="prefs-row">
              <label className="layout-prefix">
                🧩 Awalan label di lembar Auto Layout
                <input
                  type="text"
                  value={layoutPrefix}
                  placeholder="mis. video-"
                  onChange={(e) => setLayoutPrefix(e.target.value)}
                />
              </label>
              <ResetPreferencesButton
                title="Hapus semua opsi tersimpan modul ini (slider, FPS, resolusi, format, awalan)"
                onReset={handleResetPrefs}
              />
            </div>
          </section>

          {runCtl.resultUrl && (
            <ResultCompare
              resultUrl={runCtl.resultUrl}
              resultExt={runCtl.resultExt}
              faceFrames={runCtl.faceFrames}
              meta={meta}
              params={params}
              videoUrl={videoUrl}
              sync={sync}
              onDownload={download}
              onForwardPasFoto={forwardToPasFoto}
              onForwardLayout={forwardToLayout}
            />
          )}
        </>
      )}
    </div>
  );
}
