import { useState, useEffect, useCallback } from "react";
import type { UpdateInfo } from "../modules/shared/autoUpdate";
import {
  checkForUpdate,
  shouldCheckForUpdate,
  githubUpdateConfig,
} from "../modules/shared/autoUpdate";

interface UseAutoUpdateOptions {
  /** GitHub repository owner */
  githubOwner: string;
  /** GitHub repository name */
  githubRepo: string;
  /** How often to auto-check (ms). Default: 6 hours */
  checkIntervalMs?: number;
  /** Whether to auto-check on mount. Default: true */
  autoCheck?: boolean;
}

interface UseAutoUpdateReturn {
  /** Whether an update is available */
  hasUpdate: boolean;
  /** The update info (if available) */
  updateInfo: UpdateInfo | null;
  /** Whether currently checking for updates */
  isChecking: boolean;
  /** Manually trigger a check */
  checkNow: () => Promise<void>;
  /** Dismiss the update dialog */
  dismiss: () => void;
  /** Called when user skips a version */
  onSkip: () => void;
}

/**
 * React hook for managing app auto-update flow.
 *
 * @example
 * ```tsx
 * const { hasUpdate, updateInfo, checkNow, dismiss } = useAutoUpdate({
 *   endpoint: "https://api.example.com/updates/latest",
 * });
 *
 * return (
 *   <>
 *     {hasUpdate && updateInfo && (
 *       <UpdateDialog
 *         updateInfo={updateInfo}
 *         onDismiss={dismiss}
 *         onSkip={dismiss}
 *       />
 *     )}
 *   </>
 * );
 * ```
 */
export function useAutoUpdate(options: UseAutoUpdateOptions): UseAutoUpdateReturn {
  const { githubOwner, githubRepo, checkIntervalMs, autoCheck = true } = options;

  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Create GitHub config
  const githubConfig = githubUpdateConfig({
    owner: githubOwner,
    repo: githubRepo,
    checkIntervalMs,
  });

  const doCheck = useCallback(async () => {
    if (isChecking) return;
    setIsChecking(true);

    try {
      const info = await checkForUpdate({
        ...githubConfig,
        onUpdateAvailable: (info) => {
          setUpdateInfo(info);
          setHasUpdate(true);
        },
        onNoUpdate: () => {
          setHasUpdate(false);
          setUpdateInfo(null);
        },
        onError: (err) => {
          console.warn("Update check failed:", err.message);
        },
      });

      if (info) {
        setUpdateInfo(info);
        setHasUpdate(true);
      }
    } finally {
      setIsChecking(false);
    }
  }, [githubConfig, isChecking]);

  // Auto-check on mount
  useEffect(() => {
    if (!autoCheck) return;

    const init = async () => {
      const shouldCheck = await shouldCheckForUpdate(checkIntervalMs);
      if (shouldCheck) {
        // Delay initial check by 5 seconds
        const timer = setTimeout(() => {
          doCheck();
        }, 5000);
        return () => clearTimeout(timer);
      }
    };

    init();
  }, [autoCheck, checkIntervalMs, doCheck]);

  const dismiss = useCallback(() => {
    setHasUpdate(false);
    setUpdateInfo(null);
  }, []);

  const onSkip = useCallback(() => {
    setHasUpdate(false);
    setUpdateInfo(null);
  }, []);

  return {
    hasUpdate,
    updateInfo,
    isChecking,
    checkNow: doCheck,
    dismiss,
    onSkip,
  };
}
