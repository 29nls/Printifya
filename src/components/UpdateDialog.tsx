import { useState, useCallback, useEffect } from "react";
import type { UpdateInfo, DownloadProgress } from "../modules/shared/autoUpdate";
import {
  performUpdate,
  skipVersion,
} from "../modules/shared/autoUpdate";
import "./UpdateDialog.css";

interface UpdateDialogProps {
  /** Update information */
  updateInfo: UpdateInfo;
  /** Current app version */
  currentVersion?: string;
  /** Called when dialog is dismissed */
  onDismiss: () => void;
  /** Called when user chooses to skip this version */
  onSkip: () => void;
}

export default function UpdateDialog({
  updateInfo,
  currentVersion = "0.0.0",
  onDismiss,
  onSkip,
}: UpdateDialogProps) {
  const [status, setStatus] = useState<
    "idle" | "downloading" | "installing" | "error" | "done"
  >("idle");
  const [progress, setProgress] = useState<DownloadProgress>({
    loaded: 0,
    total: 0,
    percent: 0,
  });
  const [errorMsg, setErrorMsg] = useState("");

  // Reset status when updateInfo changes (new version available)
  useEffect(() => {
    setStatus("idle");
    setProgress({ loaded: 0, total: 0, percent: 0 });
    setErrorMsg("");
  }, [updateInfo.version]);

  const handleUpdate = useCallback(async () => {
    try {
      setStatus("downloading");
      await performUpdate(updateInfo, setProgress);
      setStatus("installing");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Gagal mengunduh update");
    }
  }, [updateInfo]);

  const handleSkip = useCallback(async () => {
    await skipVersion(updateInfo.version);
    onSkip();
  }, [updateInfo.version, onSkip]);

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="update-overlay" role="dialog" aria-modal="true">
      <div className="update-dialog">
        {/* Header */}
        <div className="update-header">
          <div className="update-icon">🔄</div>
          <h2>Update Tersedia</h2>
        </div>

        {/* Version Info */}
        <div className="update-versions">
          <span className="version-current">v{currentVersion}</span>
          <span className="version-arrow">→</span>
          <span className="version-new">v{updateInfo.version}</span>
        </div>

        {/* Release Notes */}
        {updateInfo.notes && (
          <div className="update-notes">
            <h3>Apa yang baru:</h3>
            <ul>
              {Array.isArray(updateInfo.notes)
                ? updateInfo.notes.map((line, i) => (
                    <li key={i}>{String(line).replace(/^[-*]\s*/, "")}</li>
                  ))
                : updateInfo.notes.split("\n").filter(Boolean).map((line, i) => (
                    <li key={i}>{line.replace(/^[-*]\s*/, "")}</li>
                  ))}
            </ul>
          </div>
        )}

        {/* File Size */}
        {updateInfo.fileSize && (
          <div className="update-meta">
            Ukuran: {formatSize(updateInfo.fileSize)}
          </div>
        )}

        {updateInfo.releaseDate && (
          <div className="update-meta">
            Rilis: {updateInfo.releaseDate}
          </div>
        )}

        {/* Progress Bar */}
        {status === "downloading" && (
          <div className="update-progress">
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <span className="progress-text">
              {progress.percent}% — {formatSize(progress.loaded)} / {formatSize(progress.total)}
            </span>
          </div>
        )}

        {/* Installing State */}
        {status === "installing" && (
          <div className="update-status">
            <span className="spinner" />
            <p>Membuka installer...</p>
          </div>
        )}

        {/* Error State */}
        {status === "error" && (
          <div className="update-error">
            <p>❌ {errorMsg}</p>
            <button className="btn-retry" onClick={handleUpdate}>
              Coba Lagi
            </button>
          </div>
        )}

        {/* Actions */}
        {status === "idle" && (
          <div className="update-actions">
            <button className="btn-skip" onClick={handleSkip}>
              Nanti Saja
            </button>
            <button className="btn-update" onClick={handleUpdate}>
              Update Sekarang
            </button>
          </div>
        )}

        {status === "downloading" && (
          <div className="update-actions">
            <button className="btn-skip" onClick={onDismiss} disabled>
              Batal
            </button>
          </div>
        )}

        {status === "installing" && (
          <div className="update-actions">
            <button className="btn-skip" onClick={onDismiss}>
              Tutup
            </button>
          </div>
        )}

        {status === "error" && (
          <div className="update-actions">
            <button className="btn-skip" onClick={onDismiss}>
              Tutup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
