/**
 * Rekam stream canvas (animasi/video) ke WebM/MP4 via MediaRecorder dengan
 * track audio opsional — pola **BufferSource → MediaStreamAudioDestinationNode**
 * yang dipakai Video Face Enhance agar output tidak senyap, diekstrak agar
 * modul lain yang merekam canvas (animasi, slideshow, presentasi, dll.) bisa
 * memakainya tanpa menyalin logika.
 *
 * Cara kerja:
 * - Video: `canvas.captureStream(fps)` (canvas wajib mendukung captureStream).
 * - Audio (opsional): `AudioBuffer` sumber diputar ulang lewat
 *   `BufferSource → MediaStreamAudioDestinationNode` selama rekaman, dan
 *   track-nya digabung ke stream — elemen video TIDAK pernah diputar (hanya
 *   di-seek/di-draw), karena memutar elemen video lewat WebAudio bisa membuat
 *   `drawImage` berikutnya men-taint canvas (perilaku Chromium).
 * - Bila muxing audio+video tak didukung untuk `mimeType` (mis. MP4 di browser
 *   tertentu), `MediaRecorder` melempar → fallback otomatis ke video saja.
 * - Progres live: `recorder.start(timesliceMs)` membuat `dataavailable` berkala
 *   (default 250 ms), dan tiap chunk menambah `RecordProgress` (byte + jumlah
 *   chunk) — pemanggil bisa membaca snapshot kapan saja via `progress()` atau
 *   mengikuti lewat opsi `onProgress` untuk menampilkan indikator saat merekam.
 * - `stop()` menghentikan BufferSource audio, menghentikan perekaman, menunggu
 *   semua chunk terkumpul, menghentikan seluruh track, dan mengembalikan Blob.
 */

export interface RecordWithAudioAudio {
  context: AudioContext;
  buffer: AudioBuffer;
  /** Putar berulang (musik latar). Default false — satu putaran (video). */
  loop?: boolean;
}

export interface RecordWithAudioOptions {
  /** Canvas sumber video (wajib mendukung `captureStream`). */
  canvas: HTMLCanvasElement;
  /** Frame rate `captureStream` (pacing pemutaran diatur pemanggil). */
  fps: number;
  /** MimeType output: "video/webm" atau "video/mp4". */
  mimeType: string;
  /** AudioBuffer + AudioContext untuk memutar ulang audio sumber (opsional). */
  audio?: RecordWithAudioAudio | null;
  videoBitsPerSecond?: number;
  /**
   * Interval `dataavailable` (ms) agar progres live tersedia. Default 250;
   * nilai <= 0 = chunk hanya saat stop (perilaku lama).
   */
  timesliceMs?: number;
  /** Dipanggil setiap chunk baru terkumpul (kumulatif byte + jumlah chunk). */
  onProgress?: (p: RecordProgress) => void;
}

/** Snapshot progres rekaman live (byte/chunk yang terkumpul sejauh ini). */
export interface RecordProgress {
  /** Total byte yang sudah diterima dari MediaRecorder. */
  bytes: number;
  /** Jumlah chunk `dataavailable` yang sudah diterima. */
  chunkCount: number;
}

export interface AudioRecorder {
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  /** Resolve saat perekaman benar-benar berhenti (semua chunk terkumpul). */
  stopped: Promise<void>;
  /** Snapshot progres saat ini (byte/chunk) — untuk indikator live. */
  progress(): RecordProgress;
  /**
   * Hentikan BufferSource audio + perekaman; tunggu `stopped`; hentikan semua
   * track. Mengembalikan Blob hasil (mimeType yang diminta).
   */
  stop(): Promise<Blob>;
}

export function recordWithAudio(opts: RecordWithAudioOptions): AudioRecorder {
  const {
    canvas,
    fps,
    mimeType,
    audio,
    videoBitsPerSecond = 8_000_000,
    timesliceMs = 250,
    onProgress,
  } = opts;

  const canvasStream = (
    canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }
  ).captureStream(fps);

  // Audio: BufferSource → MediaStreamAudioDestinationNode. Dimulai SEKARANG
  // (saat perekaman mulai) agar track mengalir dari awal; dihentikan di stop().
  let srcNode: AudioBufferSourceNode | null = null;
  let audioTracks: MediaStreamTrack[] = [];
  if (audio) {
    try {
      const dest = new MediaStreamAudioDestinationNode(audio.context);
      srcNode = audio.context.createBufferSource();
      srcNode.buffer = audio.buffer;
      srcNode.loop = audio.loop ?? false;
      srcNode.connect(dest);
      srcNode.start();
      audioTracks = dest.stream.getAudioTracks();
    } catch {
      // gagal — rekam tanpa audio
      srcNode = null;
      audioTracks = [];
    }
  }

  const withAudio =
    audioTracks.length > 0
      ? new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
      : null;
  let stream: MediaStream;
  let recorder: MediaRecorder;
  try {
    stream = withAudio ?? canvasStream;
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
  } catch {
    // Muxing audio+video tak didukung untuk mimeType ini — ulangi video saja.
    stream = canvasStream;
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
  }

  const chunks: BlobPart[] = [];
  let bytes = 0;
  let chunkCount = 0;
  const notifyProgress = () => {
    if (onProgress) {
      try {
        onProgress({ bytes, chunkCount });
      } catch {
        // callback pemakai melempar — jangan merusak perekaman
      }
    }
  };
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
      bytes += e.data.size;
      chunkCount += 1;
      notifyProgress();
    }
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(timesliceMs > 0 ? timesliceMs : undefined);

  return {
    stream,
    recorder,
    chunks,
    stopped,
    progress: () => ({ bytes, chunkCount }),
    stop: async () => {
      try {
        srcNode?.stop();
      } catch {
        // abaikan
      }
      try {
        recorder.stop();
      } catch {
        // recorder sudah berhenti
      }
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      return new Blob(chunks, { type: mimeType });
    },
  };
}
