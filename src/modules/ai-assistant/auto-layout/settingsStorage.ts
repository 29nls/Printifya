/**
 * Penyimpanan pengaturan Auto Layout ke localStorage (via prefsStorage
 * bersama, pola sama dengan modul AI lain): kunci ber-prefix `printifya.`
 * dan akses dibungkus try/catch.
 *
 * Yang disimpan: grid (kolom/baris/margin), label (tampilkan nama, ukuran
 * label), bingkai photobox & garis potong — dipakai sebagai nilai default
 * pada kunjungan berikutnya. Kolom/baris di-clamp terhadap preset ukuran
 * aktif oleh pemanggil (batas maks berbeda per ukuran pas foto).
 */

import {
  loadJSON,
  removeKeys,
  saveJSON,
} from "../../shared/prefsStorage";

const SETTINGS_KEY = "printifya.auto-layout.settings";

export interface LayoutSettings {
  cols: number;
  rows: number;
  marginCm: number;
  /** Id ukuran kertas (lihat photo-studio/shared/paperSize.ts); fallback "a4". */
  paperId: string;
  showLabels: boolean;
  labelSize: string; // "small" | "medium" | "large"
  /** Id bingkai photobox (lihat photo-studio/shared/frames.ts); "" = tanpa. */
  frameId: string;
  /** Garis potong putus-putus antar sel (sekat setelah cetak). */
  cutLines: boolean;
}

const LABEL_SIZES = ["small", "medium", "large"];

export function loadLayoutSettings(): Partial<LayoutSettings> | null {
  return loadJSON<Partial<LayoutSettings>>(SETTINGS_KEY, (value) => {
    if (!value || typeof value !== "object") return null;
    const p = value as Partial<LayoutSettings>;
    return {
      cols: typeof p.cols === "number" ? p.cols : undefined,
      rows: typeof p.rows === "number" ? p.rows : undefined,
      marginCm: typeof p.marginCm === "number" ? p.marginCm : undefined,
      paperId: typeof p.paperId === "string" ? p.paperId : undefined,
      showLabels:
        typeof p.showLabels === "boolean" ? p.showLabels : undefined,
      labelSize:
        typeof p.labelSize === "string" && LABEL_SIZES.includes(p.labelSize)
          ? p.labelSize
          : undefined,
      frameId: typeof p.frameId === "string" ? p.frameId : undefined,
      cutLines:
        typeof p.cutLines === "boolean" ? p.cutLines : undefined,
    };
  });
}

export function saveLayoutSettings(s: LayoutSettings): void {
  saveJSON(SETTINGS_KEY, s);
}

/** Hapus kunci localStorage milik modul ini. */
export function clearLayoutSettings(): void {
  removeKeys(SETTINGS_KEY);
}
