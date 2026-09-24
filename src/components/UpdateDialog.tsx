import { useState, useCallback, useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import type { UpdateInfo, DownloadProgress } from "../modules/shared/autoUpdate";
import {
  canInstallApk,
  describeUpdateError,
  InstallPermissionError,
  openInstallPermissionSettings,
  openUpdatePage,
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
  const [needsInstallPermission, setNeedsInstallPermission] = useState(false);
  const [awaitingPermission, setAwaitingPermission] = useState(false);

  /** Pengguna sedang/baru saja diantar ke Pengaturan izin (dibaca listener di bawah). */
  const awaitingPermissionRef = useRef(false);
  /** Update sudah dilanjutkan otomatis — jangan diulang saat kembali lagi. */
  const autoResumedRef = useRef(false);

  // Reset status when updateInfo changes (new version available)
  useEffect(() => {
    setStatus("idle");
    setProgress({ loaded: 0, total: 0, percent: 0 });
    setErrorMsg("");
    setNeedsInstallPermission(false);
    setAwaitingPermission(false);
    awaitingPermissionRef.current = false;
    autoResumedRef.current = false;
  }, [updateInfo.version]);

  const handleUpdate = useCallback(async () => {
    try {
      awaitingPermissionRef.current = false;
      autoResumedRef.current = false;
      setAwaitingPermission(false);
      setNeedsInstallPermission(false);
      setStatus("downloading");
      await performUpdate(updateInfo, setProgress);
      setStatus("installing");
    } catch (err) {
      setStatus("error");
      setNeedsInstallPermission(err instanceof InstallPermissionError);
      setErrorMsg(describeUpdateError(err));
    }
  }, [updateInfo]);

  // Izin "Install aplikasi tidak dikenal" tidak bisa diminta lewat dialog biasa,
  // jadi pengguna diantar langsung ke layar pengaturannya.
  const handleOpenInstallSettings = useCallback(async () => {
    try {
      autoResumedRef.current = false;
      awaitingPermissionRef.current = true;
      setAwaitingPermission(true);
      await openInstallPermissionSettings();
    } catch (err) {
      awaitingPermissionRef.current = false;
      setAwaitingPermission(false);
      setErrorMsg(describeUpdateError(err));
    }
  }, []);

  // Pengguna pergi ke Pengaturan (aplikasi jeda) lalu kembali (aktif) — kalau
  // izinnya sudah aktif, update dilanjutkan sendiri tanpa menekan Coba Lagi.
  useEffect(() => {
    if (status !== "error" || !needsInstallPermission) return;

    let listener: PluginListenerHandle | undefined;
    let cancelled = false;

    App.addListener("appStateChange", async ({ isActive }) => {
      if (!isActive || cancelled) return;
      if (!awaitingPermissionRef.current || autoResumedRef.current) return;

      // Kembali ke aplikasi belum berarti izin diberikan — cek dulu.
      if (!(await canInstallApk())) return;

      autoResumedRef.current = true;
      awaitingPermissionRef.current = false;
      await handleUpdate();
    }).then((handle) => {
      if (cancelled) handle.remove();
      else listener = handle;
    });

    return () => {
      cancelled = true;
      listener?.remove();
    };
  }, [status, needsInstallPermission, handleUpdate]);

  // Jalur penyelamat: buka halaman rilis di browser eksternal, agar pengguna
  // tetap bisa update saat unduhan di aplikasi gagal (mis. koneksi diblokir).
  const handleOpenPage = useCallback(async () => {
    try {
      await openUpdatePage(updateInfo);
    } catch (err) {
      setErrorMsg(describeUpdateError(err));
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
            <div className="update-error-actions">
              <button className="btn-retry" onClick={handleUpdate}>
                Coba Lagi
              </button>
              {needsInstallPermission ? (
                <button
                  className="btn-open-page"
                  onClick={handleOpenInstallSettings}
                >
                  Buka Pengaturan
                </button>
              ) : (
                <button className="btn-open-page" onClick={handleOpenPage}>
                  Buka di Browser
                </button>
              )}
            </div>
            {awaitingPermission && (
              <p className="update-hint">
                Aktifkan izinnya, lalu kembali ke Printifya — update dilanjutkan
                otomatis.
              </p>
            )}
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
