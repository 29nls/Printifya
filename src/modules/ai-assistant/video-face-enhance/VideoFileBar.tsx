/**
 * Komponen area file Video Face Enhance — diekstrak dari monolit
 * video-face-enhance/index.tsx (refactor murni, tanpa perubahan perilaku).
 *
 * Murni presentasional: UploadZone (zone upload + input tersembunyi + pesan
 * error) dan FileInfoBar (nama/dimensi/badge audio + mini waveform klik-putar
 * + tombol "Video Lain") menerima state & handler via props; pemilik state
 * dan logika tetap index.tsx (hook tidak disentuh).
 */
import { useRef } from "react";
import type { DragEvent } from "react";
import type { WaveformAudioApi } from "./useWaveformAudio";
import type { VideoMeta } from "./useVideoEnhanceRun";

/** Teks tooltip waveform: durasi, puncak dB, jumlah kanal (untuk data-tip). */
function formatWaveTip(s: {
  duration: number;
  peakDb: number;
  channels: number;
} | null): string {
  if (!s) return "";
  const db =
    s.peakDb === -Infinity
      ? "−∞ dB"
      : `${Math.min(0, s.peakDb).toFixed(1)} dB`;
  return `Durasi ${s.duration.toFixed(1)} dtk · Puncak ${db} · ${s.channels} kanal`;
}

interface UploadZoneProps {
  dragOver: boolean;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
  onFile: (file?: File | null) => void;
  error: string;
}

export function UploadZone({
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onFile,
  error,
}: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="panel">
      <div
        className={dragOver ? "upload-zone dragging" : "upload-zone"}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="upload-icon">🎬</div>
        <h3>Seret & letakkan video di sini</h3>
        <p>atau klik untuk memilih file — MP4, WebM, atau format video lain</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <p className="error">{error}</p>}
      <p className="hint">
        💡 Mengikuti <code>PGTFormer</code> (Beyond Alignment: Blind Video
        Face Restoration via Parsing-Guided Temporal-Coherent Transformer):{" "}
        wajah dideteksi per frame (heuristik warna kulit), pemulihan
        difokuskan ke kotak wajah (parsing-guided), dan{" "}
        <strong>Koherensi Temporal</strong> menstabilkan wajah antar frame
        tanpa menyelaraskan pose (tanpa pre-alignment) — hasilnya video
        bebas kedipan, direkam langsung di browser.
      </p>
    </section>
  );
}

interface FileInfoBarProps {
  fileName: string;
  meta: VideoMeta;
  hasAudio: boolean | null;
  wave: WaveformAudioApi;
  onResetVideo: () => void;
}

export function FileInfoBar({
  fileName,
  meta,
  hasAudio,
  wave,
  onResetVideo,
}: FileInfoBarProps) {
  return (
    <div className="file-row">
      <span className="file-title">
        🎬 Video: <strong>{fileName}</strong>
        <span className="dims">
          {" "}
          — {meta.w} × {meta.h} px, {meta.duration.toFixed(1)} dtk
          {hasAudio === true
            ? " 🔊 audio"
            : hasAudio === false
              ? " 🔇 tanpa audio"
              : ""}
        </span>
        {hasAudio === true && (
          <span className="audio-wave">
            {wave.audioStatus === "decoding" ? (
              <span className="wave-note">⏳ membaca audio…</span>
            ) : wave.audioStatus === "failed" ? (
              <span
                className="wave-note wave-fail"
                title="Track audio ada, tapi gagal di-decode (format tak didukung atau terlalu besar) — hasil akan direkam tanpa suara."
              >
                ⚠️ audio tak terbaca
              </span>
            ) : wave.waveform ? (
              <span className="wave-wrap" data-tip={formatWaveTip(wave.waveStats)}>
                <svg
                  ref={wave.waveSvgRef}
                  className={wave.wavePlaying ? "waveform playing" : "waveform"}
                  width={160}
                  height={24}
                  viewBox="0 0 160 24"
                  role="button"
                  tabIndex={0}
                  aria-label={
                    wave.wavePlaying
                      ? "Jeda audio sumber (klik untuk menghentikan)"
                      : "Putar audio sumber (klik untuk memutar, cek cepat)"
                  }
                  aria-pressed={wave.wavePlaying}
                  onClick={wave.toggleWaveAudio}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      wave.toggleWaveAudio();
                    }
                  }}
                >
                  <title>
                    {wave.wavePlaying
                      ? "Memutar audio sumber — klik untuk menghentikan"
                      : "Klik untuk memutar audio sumber (cek cepat)"}
                    {wave.waveStats ? ` — ${formatWaveTip(wave.waveStats)}` : ""}
                  </title>
                  {Array.from(wave.waveform, (p, i) => {
                    const h = Math.max(1, Math.round(p * 20));
                    const y = (24 - h) / 2;
                    return (
                      <rect
                        key={i}
                        x={i}
                        y={y}
                        width={1}
                        height={h}
                        className="wave-bar"
                      />
                    );
                  })}
                </svg>
              </span>
            ) : null}
          </span>
        )}
      </span>
      <button type="button" className="btn" onClick={onResetVideo}>
        🔄 Video Lain
      </button>
    </div>
  );
}
