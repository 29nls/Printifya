/**
 * Definisi ukuran kertas untuk template cetak (pas foto / Auto Layout).
 *
 * Default A4 (210×297 mm). Di samping seri A (A3/A4/A5) tersedia ukuran foto
 * seri R ala studio foto Indonesia: 2R–30R (termasuk varian "+" yang lebih
 * panjang), memakai dimensi standar yang umum di pasaran (mm, orientasi
 * potret sesuai hasil cetak foto).
 */

export interface PaperSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

export const PAPER_SIZES: PaperSize[] = [
  { id: "a3", name: "A3", widthMm: 297, heightMm: 420 },
  { id: "a4", name: "A4", widthMm: 210, heightMm: 297 },
  { id: "a5", name: "A5", widthMm: 148, heightMm: 210 },
  { id: "2r", name: "2R", widthMm: 63.5, heightMm: 88.9 },
  { id: "3r", name: "3R", widthMm: 88.9, heightMm: 127 },
  { id: "4r", name: "4R", widthMm: 101.6, heightMm: 152.4 },
  { id: "5r", name: "5R", widthMm: 127, heightMm: 177.8 },
  { id: "6r", name: "6R", widthMm: 152.4, heightMm: 203.2 },
  { id: "8r", name: "8R", widthMm: 203.2, heightMm: 254 },
  { id: "8rp", name: "8R+", widthMm: 203.2, heightMm: 304.8 },
  { id: "10r", name: "10R", widthMm: 254, heightMm: 304.8 },
  { id: "10rp", name: "10R+", widthMm: 254, heightMm: 381 },
  { id: "12r", name: "12R", widthMm: 304.8, heightMm: 406.4 },
  { id: "12rp", name: "12R+", widthMm: 304.8, heightMm: 457.2 },
  { id: "16r", name: "16R", widthMm: 406.4, heightMm: 508 },
  { id: "20r", name: "20R", widthMm: 508, heightMm: 609.6 },
  { id: "24r", name: "24R", widthMm: 609.6, heightMm: 800 },
  { id: "30r", name: "30R", widthMm: 750, heightMm: 1000 },
];

export const PAPER_A4: PaperSize = PAPER_SIZES.find((p) => p.id === "a4")!;

/** Cari kertas berdasarkan id; fallback A4 bila tidak dikenal. */
export function getPaper(id: string | undefined): PaperSize {
  return PAPER_SIZES.find((p) => p.id === id) ?? PAPER_A4;
}
