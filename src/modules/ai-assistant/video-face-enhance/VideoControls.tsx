/**
 * Komponen kontrol Video Face Enhance — diekstrak dari monolit
 * video-face-enhance/index.tsx (refactor murni, tanpa perubahan perilaku).
 *
 * Murni presentasional: menerima state + handler via props dari index.tsx
 * (pemilik state & logika — hook useWaveformAudio/useSyncCompare/
 * useVideoEnhanceRun tidak disentuh). Slider mengubah params secara live,
 * select sampling/fps/format/resolusi bekerja, progress bar + fps/ETA
 * ditampilkan, tombol run/cancel/reset memakai handler yang diteruskan.
 */
import type { FaceEnhanceParams } from "../../shared/facePipeline";
import {
  FPS_OPTIONS,
  FORMATS,
  FRAME_SAMPLING,
  RES_MODES,
  formatEta,
  type FrameSampling,
  type VideoEnhanceParams,
} from "./videoEnhance";
import type { RunProgress } from "./useVideoEnhanceRun";

const SLIDERS: {
  key: keyof FaceEnhanceParams;
  label: string;
  min: number;
  max: number;
}[] = [
  { key: "fidelity", label: "Fidelitas (w)", min: 0, max: 100 },
  { key: "smooth", label: "Pemulusan Kulit", min: 0, max: 100 },
  { key: "sharpen", label: "Ketajaman", min: 0, max: 100 },
  { key: "color", label: "Koreksi Warna", min: 0, max: 100 },
];

interface EnhanceControlsProps {
  params: VideoEnhanceParams;
  onParamsChange: (
    updater: (p: VideoEnhanceParams) => VideoEnhanceParams
  ) => void;
  processing: boolean;
  progress: RunProgress | null;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
  mp4Supported: boolean;
  effFormat: "webm" | "mp4";
}

export function EnhanceControls({
  params,
  onParamsChange,
  processing,
  progress,
  onRun,
  onCancel,
  onReset,
  mp4Supported,
  effFormat,
}: EnhanceControlsProps) {
  return (
    <div className="enhance-controls">
      <div className="enhance-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={processing}
          onClick={onRun}
        >
          {processing
            ? `Memproses… (${progress?.done ?? 0}/${progress?.total ?? 0})`
            : "🚀 Pulihkan Video"}
        </button>
        {processing && (
          <button type="button" className="btn" onClick={onCancel}>
            ✋ Batal
          </button>
        )}
        <button
          type="button"
          className="btn"
          disabled={processing}
          onClick={onReset}
        >
          ↺ Reset
        </button>
      </div>

      <div className="sliders">
        {SLIDERS.map((s) => (
          <label key={s.key} className="slider-row">
            <span className="slider-label">{s.label}</span>
            <input
              type="range"
              min={s.min}
              max={s.max}
              value={params[s.key] as number}
              onChange={(e) =>
                onParamsChange((p) => ({
                  ...p,
                  [s.key]: Number(e.target.value),
                }))
              }
            />
            <span className="slider-value">{params[s.key] as number}</span>
          </label>
        ))}
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={params.background}
            onChange={(e) =>
              onParamsChange((p) => ({ ...p, background: e.target.checked }))
            }
          />
          <span>🖼️ Perbaiki latar juga (background enhancement)</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={params.restoreColor}
            onChange={(e) =>
              onParamsChange((p) => ({
                ...p,
                restoreColor: e.target.checked,
              }))
            }
          />
          <span>🎨 Pulihkan warna video pudar / hitam-putih</span>
        </label>
        <label className="slider-row">
          <span className="slider-label">Koherensi Temporal</span>
          <input
            type="range"
            min={0}
            max={100}
            value={params.temporal}
            onChange={(e) =>
              onParamsChange((p) => ({
                ...p,
                temporal: Number(e.target.value),
              }))
            }
            title="PGTFormer: seberapa kuat hasil frame di-blend dengan frame sebelumnya (kurangi kedipan)"
          />
          <span className="slider-value">{params.temporal}</span>
        </label>
      </div>

      <div className="video-options">
        <label>
          FPS output
          <select
            className="tool-select"
            value={params.fps}
            onChange={(e) =>
              onParamsChange((p) => ({ ...p, fps: Number(e.target.value) }))
            }
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ukuran proses
          <select
            className="tool-select"
            value={params.resMode}
            onChange={(e) =>
              onParamsChange((p) => ({
                ...p,
                resMode: e.target.value as VideoEnhanceParams["resMode"],
              }))
            }
          >
            {RES_MODES.map((m) => (
              <option key={m} value={m}>
                {m === "512"
                  ? "512 px (PGTFormer)"
                  : m === "720"
                    ? "720 px"
                    : "Asli"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Format video
          <select
            className="tool-select"
            value={effFormat}
            onChange={(e) =>
              onParamsChange((p) => ({
                ...p,
                format: e.target.value as VideoEnhanceParams["format"],
              }))
            }
          >
            {FORMATS.map((f) => (
              <option
                key={f}
                value={f}
                disabled={f === "mp4" && !mp4Supported}
              >
                {f.toUpperCase()}
                {f === "mp4" && !mp4Supported ? " (tak didukung)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label
          title="Proses sebagian frame untuk video panjang: tiap frame hasil ditahan beberapa slot output, jadi durasi & FPS tetap sama — hanya kehalusan gerak berkurang."
        >
          Sampling frame
          <select
            className="tool-select"
            value={params.frameSampling}
            onChange={(e) =>
              onParamsChange((p) => ({
                ...p,
                frameSampling: e.target.value as FrameSampling,
              }))
            }
          >
            {FRAME_SAMPLING.map((s) => (
              <option key={s} value={s}>
                {s === "all"
                  ? "Semua (paling halus)"
                  : s === "half"
                    ? "Setengah (2× lebih cepat)"
                    : "Sepertiga (3× lebih cepat)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      {processing && progress && (
        <div className="vfe-progress">
          <div className="vfe-progress-bar">
            <div
              className="vfe-progress-fill"
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
              }}
            />
          </div>
          <span>
            Frame {progress.done} / {progress.total} (
            {Math.round((progress.done / progress.total) * 100)}%)
            {progress.fps > 0 && (
              <span className="vfe-speed">
                {" "}
                ·{" "}
                {progress.fps >= 10
                  ? Math.round(progress.fps)
                  : progress.fps.toFixed(1)}{" "}
                fps
                {progress.etaSec > 0 && (
                  <> · sisa ~{formatEta(progress.etaSec)}</>
                )}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
