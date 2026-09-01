import { useState, useEffect, useCallback, useMemo } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
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
  /** Current app version */
  currentVersion: string;
  /** Whether currently checking for updates */
  isChecking: boolean;
  /** Manually trigger a check */
  checkNow: () => Promise<void>;
  /** Dismiss the update dialog */
  dismiss: () => void;
  /** Called when user skips a version */
  onSkip: () => void;
}

export function useAutoUpdate(options: UseAutoUpdateOptions): UseAutoUpdateReturn {
  const { githubOwner, githubRepo, checkIntervalMs, autoCheck = true } = options;

  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState("0.0.0");
  const [isChecking, setIsChecking] = useState(false);

  // Memoize the GitHub config so it doesn't change every render
  const githubConfig = useMemo(
    () =>
      githubUpdateConfig({
        owner: githubOwner,
        repo: githubRepo,
        checkIntervalMs,
      }),
    [githubOwner, githubRepo, checkIntervalMs],
  );

  // Fetch current app version on mount
  useEffect(() => {
    async function loadVersion() {
      try {
        if (Capacitor.isNativePlatform()) {
          const info = await App.getInfo();
          setCurrentVersion(info.version);
        }
      } catch {
        // Keep default
      }
    }
    loadVersion();
  }, []);

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

    let timer: ReturnType<typeof setTimeout>;
    const init = async () => {
      const shouldCheck = await shouldCheckForUpdate(checkIntervalMs);
      if (shouldCheck) {
        // Delay initial check by 5 seconds
        timer = setTimeout(() => {
          doCheck();
        }, 5000);
      }
    };

    init();

    return () => {
      if (timer) clearTimeout(timer);
    };
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
    currentVersion,
    isChecking,
    checkNow: doCheck,
    dismiss,
    onSkip,
  };
}
