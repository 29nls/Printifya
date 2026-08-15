/** Konfigurasi ukuran pas foto — satu-satunya hal yang membedakan tiap modul pas foto. */
export interface PasFotoSize {
  /** Slug unik, mis. "2x3". */
  id: string;
  /** Judul modul, mis. "Pas Foto 2x3". */
  title: string;
  /** Label ukuran cetak, mis. "2 × 3 cm". */
  label: string;
  /** Deskripsi singkat halaman. */
  description: string;
  /** Ikon modul. */
  icon: string;
  /** Dimensi output dalam piksel @ 300 DPI. */
  widthPx: number;
  heightPx: number;
  /** Dimensi cetak fisik dalam mm. */
  widthMm: number;
  heightMm: number;
  /** Nama dasar file hasil (PNG & PDF). */
  fileName: string;
}
