/**
 * Hook audio waveform video sumber (indikator mini + cek cepat klik waveform)
 * — diekstrak dari monolit video-face-enhance/index.tsx (refactor murni,
 * tanpa perubahan perilaku).
 *
 * Memiliki SATU sumber AudioBuffer (`audioSharedRef`) yang JUGA dipakai
 * `run()` saat rekaman: keduanya menerima instance & promise yang sama persis
 * via `resolveSharedAudioBuffer` — audio di-decode hanya sekali per video.
 * Pemutaran cek cepat memakai BufferSource → context.destination; elemen
 * video TIDAK pernah diputar (menjaga drawImage agar tidak men-taint canvas).
 */
import {
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  createSharedAudioState,
  decodeAudioBuffer,
  resolveSharedAudioBuffer,
  type SharedAudioState,
} from "../../shared/audioShared";
import { computePeaks, computeWaveStats } from "./videoEnhance";

export interface WaveStats {
  duration: number;
  peakDb: number;
  channels: number;
}

/** Batas memori wajar untuk AudioBuffer (float32 × kanal × sampel) — video
 *  ultra-panjang direkam tanpa audio daripada memakai ratusan MB RAM. */
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** Buat AudioContext (dengan fallback webkit). Dipakai untuk memutar ulang
 *  audio saat rekaman (dibuat/resume DALAM gestur klik). */
export function makeAudioContext(): AudioContext | null {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export interface WaveformAudioApi {
  audioStatus: "idle" | "decoding" | "ready" | "failed";
  waveform: Float32Array | null;
  waveStats: WaveStats | null;
  wavePlaying: boolean;
  /** AudioBuffer sumber (buffer + promise) — SATU sumber untuk waveform DAN
   *  rekaman: run() membaca `.buffer` dan memakai promise yang sama. */
  audioSharedRef: MutableRefObject<SharedAudioState>;
  /** AudioContext — dibuat dalam gestur klik; dipakai waveform & rekaman. */
  audioCtxRef: MutableRefObject<AudioContext | null>;
  /** Ref SVG waveform (JSX) — bar rect di-cache untuk loop playhead. */
  waveSvgRef: MutableRefObject<SVGSVGElement | null>;
  /** Pastikan AudioBuffer ter-decode (sekali per video; di-cache). `null`
   *  bila tanpa audio / decode gagal / terlalu besar. */
  ensureAudioBuffer: () => Promise<AudioBuffer | null>;
  /** Putar/jeda cek cepat audio sumber (klik waveform). */
  toggleWaveAudio: () => void;
  /** Hentikan cek cepat — dipakai toggle, ganti video, cleanup unmount. */
  stopWaveAudio: () => void;
  /** Ganti video: hentikan playback, buang buffer/promise lama (objek
   *  DIGANTI, bukan dimutasi — decode yang masih berjalan menulis ke objek
   *  lama → tidak bocor ke video berikutnya), reset indikator. */
  resetAudioForNewVideo: () => void;
}

export function useWaveformAudio(
  videoUrl: string | null,
  hasAudio: boolean | null
): WaveformAudioApi {
  const [audioStatus, setAudioStatus] = useState<
    "idle" | "decoding" | "ready" | "failed"
  >("idle");
  const [waveform, setWaveform] = useState<Float32Array | null>(null);
  const [waveStats, setWaveStats] = useState<WaveStats | null>(null);
  const [wavePlaying, setWavePlaying] = useState(false);
  const waveSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const waveSvgRef = useRef<SVGSVGElement>(null);
  const waveBarsRef = useRef<SVGRectElement[]>([]);
  const wavePlayheadRaf = useRef<number>(0);
  const waveStartCtxTime = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSharedRef = useRef<SharedAudioState>(createSharedAudioState());

  /**
   * Pastikan AudioBuffer sumber ter-decode (sekali per video; hasil di-cache
   * di `audioSharedRef`). Dipakai indikator waveform (segera setelah upload)
   * dan `run()` (saat rekaman) — keduanya berbagi promise yang sama, jadi
   * tidak ada decode ganda atau race, dan menerima instance yang sama persis.
   */
  const ensureAudioBuffer = (): Promise<AudioBuffer | null> =>
    resolveSharedAudioBuffer(audioSharedRef.current, async () => {
      if (!videoUrl) return null;
      try {
        const raw = await (await fetch(videoUrl)).arrayBuffer();
        const decoded = await decodeAudioBuffer(raw);
        const bytes =
          decoded !== null
            ? decoded.length *
              decoded.numberOfChannels *
              Float32Array.BYTES_PER_ELEMENT
            : Infinity;
        return bytes <= MAX_AUDIO_BYTES ? decoded : null;
      } catch {
        return null;
      }
    });

  /** Bersihkan sorot bucket yang sedang berbunyi dari semua bar. */
  const clearWaveActive = () => {
    for (const b of waveBarsRef.current) {
      b.classList.remove("wave-bar-active");
    }
  };

  const stopWaveAudio = () => {
    cancelAnimationFrame(wavePlayheadRaf.current);
    wavePlayheadRaf.current = 0;
    clearWaveActive();
    if (waveSourceRef.current) {
      try {
        waveSourceRef.current.stop();
      } catch {
        // sudah berhenti — abaikan
      }
      waveSourceRef.current = null;
    }
    setWavePlaying(false);
  };

  const toggleWaveAudio = () => {
    const buf = audioSharedRef.current.buffer;
    if (!buf) return;
    if (waveSourceRef.current) {
      stopWaveAudio();
      return;
    }
    // Context dibuat/resume dalam gestur klik (autoplay dengan suara diizinkan).
    const ctx =
      audioCtxRef.current ?? (audioCtxRef.current = makeAudioContext());
    if (!ctx) return;
    void ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => {
      waveSourceRef.current = null;
      cancelAnimationFrame(wavePlayheadRaf.current);
      wavePlayheadRaf.current = 0;
      clearWaveActive();
      setWavePlaying(false);
    };
    waveSourceRef.current = src;
    try {
      src.start();
    } catch {
      waveSourceRef.current = null;
      setWavePlaying(false);
      return;
    }
    // Loop playhead: sorot bucket yang sedang berbunyi mengikuti posisi
    // BufferSource (ctx.currentTime - waktu mulai) — umpan balik waktu tanpa
    // re-render React (menulis class langsung ke rect SVG).
    const startCtxTime = ctx.currentTime;
    waveStartCtxTime.current = startCtxTime;
    const playheadTick = () => {
      if (!waveSourceRef.current) {
        clearWaveActive();
        return;
      }
      const pos = Math.max(0, ctx.currentTime - startCtxTime);
      const dur = buf.duration || 0;
      const bars = waveBarsRef.current;
      if (bars.length > 0 && dur > 0) {
        const idx = Math.min(
          bars.length - 1,
          Math.floor((pos / dur) * bars.length)
        );
        for (let i = 0; i < bars.length; i++) {
          bars[i].classList.toggle("wave-bar-active", i === idx);
        }
      }
      wavePlayheadRaf.current = requestAnimationFrame(playheadTick);
    };
    wavePlayheadRaf.current = requestAnimationFrame(playheadTick);
    setWavePlaying(true);
  };

  const resetAudioForNewVideo = () => {
    stopWaveAudio();
    audioSharedRef.current = createSharedAudioState();
    setWaveform(null);
    setWaveStats(null);
    setAudioStatus("idle");
  };

  // Decode audio segera setelah video dipilih → indikator waveform meyakinkan
  // pengguna bahwa track audio benar-benar terbaca (bukan hanya ada track).
  useEffect(() => {
    if (!videoUrl || hasAudio !== true) {
      setAudioStatus("idle");
      setWaveform(null);
      setWaveStats(null);
      return;
    }
    let cancelled = false;
    setAudioStatus("decoding");
    void ensureAudioBuffer().then((buf) => {
      if (cancelled) return;
      if (buf) {
        const peaks = computePeaks(buf);
        setWaveform(peaks);
        setWaveStats(computeWaveStats(peaks, buf.duration, buf.numberOfChannels));
        setAudioStatus("ready");
      } else {
        setWaveform(null);
        setWaveStats(null);
        setAudioStatus("failed");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl, hasAudio]);

  // Cache rect bar SVG saat waveform berubah → loop playhead tidak perlu
  // querySelectorAll tiap frame (160 node × 60 fps tetap murah, tapi cache
  // membuat loop lebih ringan).
  useEffect(() => {
    if (waveSvgRef.current) {
      waveBarsRef.current = Array.from(
        waveSvgRef.current.querySelectorAll<SVGRectElement>(".wave-bar")
      );
    }
  }, [waveform]);

  // Cleanup unmount: hentikan playback cek cepat, tutup AudioContext, buang
  // buffer/promise (objek DIGANTI agar decode tertunda tidak bocor).
  useEffect(() => {
    return () => {
      stopWaveAudio();
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch {
          // abaikan
        }
        audioCtxRef.current = null;
        audioSharedRef.current = createSharedAudioState();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    audioStatus,
    waveform,
    waveStats,
    wavePlaying,
    audioSharedRef,
    audioCtxRef,
    waveSvgRef,
    ensureAudioBuffer,
    toggleWaveAudio,
    stopWaveAudio,
    resetAudioForNewVideo,
  };
}
