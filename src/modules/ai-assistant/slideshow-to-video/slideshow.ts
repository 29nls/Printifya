/**
 * Slideshow to Video — logika murni (tanpa DOM) untuk menyusun foto menjadi
 * video: tata letak cover-fit per slide, timing transisi fade, dan durasi
 * total. Dipakai pratinjau (rAF di thread utama) DAN perekaman, jadi kedua
 * jalur menghasilkan frame yang sama persis.
 */

export interface SlideshowSettings {
  /** Detik per slide. */
  slideDur: number;
  /** Detik transisi fade (tumpang-tindih di akhir tiap slide). */
  fadeDur: number;
  /** FPS output (captureStream + perekaman). */
  fps: number;
  /** Lebar kanvas kerja/output. */
  width: number;
  /** Tinggi kanvas kerja/output. */
  height: number;
}

export const SLIDESHOW_RES = [
  { id: "720", label: "720p (1280×720)", width: 1280, height: 720 },
  { id: "1080", label: "1080p (1920×1080)", width: 1920, height: 1080 },
] as const;

export const SLIDESHOW_FPS = [15, 24, 30] as const;

/** Rect cover-fit: gambar di-crop terpusat agar menutupi kanvas penuh
 *  (bagian yang meluap terpotong — tidak ada pita kosong). */
export function coverFit(
  imgW: number,
  imgH: number,
  cw: number,
  ch: number
): { dx: number; dy: number; dw: number; dh: number } {
  const scale = Math.max(cw / imgW, ch / imgH);
  const dw = imgW * scale;
  const dh = imgH * scale;
  return { dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh };
}

export interface SlideFrame {
  /** Slide utama yang sedang tampil. */
  index: number;
  /** Slide berikutnya (target fade); null di slide terakhir / tanpa fade. */
  next: number | null;
  /** 0..1 — proporsi transisi menuju `next` (0 = sepenuhnya `index`). */
  fade: number;
}

/** Durasi total = jumlah slide × durasi per slide (fade tumpang-tindih di
 *  akhir tiap slide, tidak menambah durasi). */
export function totalDuration(slideCount: number, slideDur: number): number {
  return Math.max(0, slideCount) * Math.max(0, slideDur);
}

/**
 * State frame pada waktu `t` (detik): slide aktif + progress fade. Fade
 * dimulai `fadeDur` sebelum peralihan dan selesai tepat saat peralihan;
 * dibatasi maksimal setengah durasi slide agar tidak menimpa slide
 * sebelumnya. Slide terakhir tidak fade keluar.
 */
export function frameAt(
  t: number,
  slideCount: number,
  slideDur: number,
  fadeDur: number
): SlideFrame {
  if (slideCount <= 0 || slideDur <= 0) {
    return { index: 0, next: null, fade: 0 };
  }
  const effFade = Math.min(Math.max(0, fadeDur), slideDur / 2);
  const idx = Math.min(
    slideCount - 1,
    Math.max(0, Math.floor(t / slideDur))
  );
  if (idx >= slideCount - 1) return { index: idx, next: null, fade: 0 };
  const inSlide = t - idx * slideDur;
  const fadeStart = slideDur - effFade;
  if (inSlide <= fadeStart) return { index: idx, next: idx + 1, fade: 0 };
  const fade = Math.min(1, (inSlide - fadeStart) / effFade);
  return { index: idx, next: idx + 1, fade };
}
