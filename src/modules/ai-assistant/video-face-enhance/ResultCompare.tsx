/**
 * Komponen panel hasil & banding Video Face Enhance — diekstrak dari monolit
 * video-face-enhance/index.tsx (refactor murni, tanpa perubahan perilaku).
 *
 * Murni presentasional: pemutar sebelum/sesudah + timecode sinkron, kontrol
 * Putar Keduanya/Bisukan/Berhenti (semua dari useSyncCompare via props),
 * catatan wajah, dan tombol hasil (unduh / terusan ke Pas Foto / Auto Layout
 * — handler diteruskan dari index.tsx).
 */
import {
  countFrames,
  formatTimecode,
  sampledFrames,
  type VideoEnhanceParams,
} from "./videoEnhance";
import type { SyncCompareApi } from "./useSyncCompare";
import type { VideoMeta } from "./useVideoEnhanceRun";

interface ResultCompareProps {
  resultUrl: string;
  resultExt: "webm" | "mp4";
  faceFrames: number;
  meta: VideoMeta;
  params: VideoEnhanceParams;
  videoUrl: string;
  sync: SyncCompareApi;
  onDownload: () => void;
  onForwardPasFoto: () => void;
  onForwardLayout: () => void;
}

export function ResultCompare({
  resultUrl,
  resultExt,
  faceFrames,
  meta,
  params,
  videoUrl,
  sync,
  onDownload,
  onForwardPasFoto,
  onForwardLayout,
}: ResultCompareProps) {
  return (
    <section className="panel">
      <div className="bg-compare">
        <figure>
          <figcaption>
            Sebelum (video asli)
            <span className="compare-time" ref={sync.srcTimeRef}>
              0:00:00.0
            </span>
          </figcaption>
          <video
            ref={sync.srcVideoRef}
            src={videoUrl}
            controls
            muted={sync.compareMuted}
            className="bg-preview-img"
            onTimeUpdate={() => {
              if (sync.srcTimeRef.current) {
                sync.srcTimeRef.current.textContent = formatTimecode(
                  sync.srcVideoRef.current?.currentTime ?? 0
                );
              }
            }}
          />
        </figure>
        <figure>
          <figcaption>
            Sesudah (face restored)
            <span className="compare-time" ref={sync.resTimeRef}>
              0:00:00.0
            </span>
          </figcaption>
          <video
            ref={sync.resVideoRef}
            src={resultUrl}
            controls
            muted={sync.compareMuted}
            className="bg-preview-img"
            onTimeUpdate={() => {
              if (sync.resTimeRef.current) {
                sync.resTimeRef.current.textContent = formatTimecode(
                  sync.resVideoRef.current?.currentTime ?? 0
                );
              }
            }}
          />
        </figure>
      </div>
      <div className="compare-controls">
        <button
          type="button"
          className="btn btn-primary"
          onClick={sync.playBothSync}
          title="Putar video asli & hasil bersamaan dari awal, disinkronkan (perbandingan audio/video A/B)"
        >
          ▶️ Putar Keduanya (Sinkron)
        </button>
        <button type="button" className="btn" onClick={sync.toggleMute}>
          {sync.compareMuted ? "🔇 Suarakan" : "🔊 Bisukan"}
        </button>
        <button type="button" className="btn" onClick={sync.stopBoth}>
          ⏹ Berhenti
        </button>
      </div>
      <p className="hint compare-hint">
        💡 Putar Keduanya menjalankan video asli & hasil dari detik 0
        secara sinkron — cocok untuk membandingkan audio sebelum/sesudah
        (hasil mempertahankan track audio sumber bila ada). Tombol
        Bisukan/Suarakan mengendalikan suara kedua pemutar sekaligus.
      </p>
      <p
        className={
          faceFrames > 0 ? "face-note face-found" : "face-note face-miss"
        }
      >
        {faceFrames > 0
          ? `😀 Wajah terdeteksi di ${faceFrames} dari ${sampledFrames(
              countFrames(meta.duration, params.fps),
              params.frameSampling
            )} frame — pemulihan difokuskan ke area wajah per frame (parsing-guided) dengan koherensi temporal ${params.temporal}.`
          : "😕 Wajah tidak terdeteksi di frame mana pun — koreksi warna & ketajaman ringan diterapkan ke seluruh frame."}
      </p>
      <p className="hint">
        💡 Geser/putar video hasil ke frame yang diinginkan, lalu klik
        tombol terusan untuk mengirim frame itu ke alur pas foto atau
        lembar Auto Layout.
      </p>
      <div className="result-actions">
        <button type="button" className="btn btn-primary" onClick={onDownload}>
          ⬇️ Unduh {resultExt.toUpperCase()}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onForwardPasFoto}
        >
          🪪 Jadikan Pas Foto 3x4 (frame ini)
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onForwardLayout}
        >
          🧩 Susun ke Lembar A4 (frame ini)
        </button>
      </div>
    </section>
  );
}
