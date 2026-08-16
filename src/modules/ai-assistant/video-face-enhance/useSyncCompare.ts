/**
 * Hook panel banding sebelum/sesudah video — diekstrak dari monolit
 * video-face-enhance/index.tsx (refactor murni, tanpa perubahan perilaku).
 *
 * Video sumber di sini adalah elemen TERPISAH dari `videoRef` tersembunyi
 * (yang TIDAK boleh diputar agar drawImage tidak men-taint canvas); pemutar
 * banding boleh diputar karena tidak pernah digambar ke kanvas. Loop rAF
 * menjaga kedua pemutar sejajar (drift > 0,12 dtk di-seek ulang, master =
 * sumber); timecode ditulis langsung ke span (tanpa state React, 60 fps murah).
 */
import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import { formatTimecode } from "./videoEnhance";

export interface SyncCompareApi {
  compareMuted: boolean;
  srcVideoRef: RefObject<HTMLVideoElement>;
  resVideoRef: RefObject<HTMLVideoElement>;
  srcTimeRef: MutableRefObject<HTMLSpanElement | null>;
  resTimeRef: MutableRefObject<HTMLSpanElement | null>;
  playBothSync: () => void;
  stopBoth: () => void;
  toggleMute: () => void;
}

export function useSyncCompare(resultUrl: string | null): SyncCompareApi {
  const [compareMuted, setCompareMuted] = useState(false);
  const srcVideoRef = useRef<HTMLVideoElement>(null);
  const resVideoRef = useRef<HTMLVideoElement>(null);
  const srcTimeRef = useRef<HTMLSpanElement | null>(null);
  const resTimeRef = useRef<HTMLSpanElement | null>(null);
  const syncLoopRef = useRef<number | null>(null);

  /** Hentikan loop sinkronisasi pemutaran banding (rAF). */
  const stopSyncLoop = () => {
    if (syncLoopRef.current !== null) {
      cancelAnimationFrame(syncLoopRef.current);
      syncLoopRef.current = null;
    }
  };

  /** Jeda kedua pemutar banding dan hentikan loop sinkronisasi. */
  const stopBoth = () => {
    stopSyncLoop();
    try {
      srcVideoRef.current?.pause();
      resVideoRef.current?.pause();
    } catch {
      // abaikan
    }
  };

  /**
   * Putar video sumber & hasil BERSAMAAN dari 0 (perbandingan audio/video A/B
   * yang sinkron). Dipicu gestur klik → autoplay dengan suara diizinkan
   * browser. Selama berjalan, loop rAF menjaga kedua pemutar sejajar (drift
   * > 0,12 dtk di-seek ulang, master = sumber); bila salah satu jeda/berakhir,
   * keduanya berhenti.
   */
  const playBothSync = () => {
    const src = srcVideoRef.current;
    const res = resVideoRef.current;
    if (!src || !res) return;
    stopSyncLoop();
    try {
      src.currentTime = 0;
      res.currentTime = 0;
    } catch {
      // abaikan
    }
    if (srcTimeRef.current) srcTimeRef.current.textContent = "0:00:00.0";
    if (resTimeRef.current) resTimeRef.current.textContent = "0:00:00.0";
    void Promise.allSettled([src.play(), res.play()]);
    const tick = () => {
      if (!src || !res) return;
      // Keduanya berhenti (pengguna menguasai pemutaran) → lepas sinkronisasi.
      if (src.paused && res.paused) {
        stopSyncLoop();
        return;
      }
      // Salah satu dijeda → jeda pasangannya agar tetap sinkron.
      if (src.paused !== res.paused) {
        if (src.paused) res.pause();
        else src.pause();
      }
      if (!src.paused && !res.paused) {
        const drift = src.currentTime - res.currentTime;
        if (Math.abs(drift) > 0.12) {
          res.currentTime = src.currentTime; // master = sumber
        }
      }
      // Timecode sinkron di atas kedua video — diperbarui tiap frame agar
      // terlihat sejajar (nilai sama) atau melenceng (nilai beda).
      if (srcTimeRef.current) {
        srcTimeRef.current.textContent = formatTimecode(src.currentTime);
      }
      if (resTimeRef.current) {
        resTimeRef.current.textContent = formatTimecode(res.currentTime);
      }
      if (src.ended || res.ended) {
        stopBoth();
        return;
      }
      syncLoopRef.current = requestAnimationFrame(tick);
    };
    syncLoopRef.current = requestAnimationFrame(tick);
  };

  /** Tombol mute eksplisit: bisukan/suarakan kedua pemutar banding sekaligus. */
  const toggleMute = () => {
    const next = !compareMuted;
    setCompareMuted(next);
    if (srcVideoRef.current) srcVideoRef.current.muted = next;
    if (resVideoRef.current) resVideoRef.current.muted = next;
  };

  // Timecode banding di-reset ke 0:00:00.0 saat hasil baru dibuat.
  useEffect(() => {
    if (srcTimeRef.current) srcTimeRef.current.textContent = "0:00:00.0";
    if (resTimeRef.current) resTimeRef.current.textContent = "0:00:00.0";
  }, [resultUrl]);

  // Cleanup unmount: hentikan loop sinkronisasi.
  useEffect(() => {
    return () => {
      stopSyncLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    compareMuted,
    srcVideoRef,
    resVideoRef,
    srcTimeRef,
    resTimeRef,
    playBothSync,
    stopBoth,
    toggleMute,
  };
}
