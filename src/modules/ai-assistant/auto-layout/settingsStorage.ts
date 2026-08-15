/**
 * Penyimpanan pengaturan Auto Layout ke localStorage (pola sama dengan
 * bgOptionsStorage.ts / storage.ts Template Surat): kunci ber-prefix
 * `printifya.` dan akses dibungkus try/catch.
 *
 * Yang disimpan: grid (kolom/baris/margin) dan label (tampilkan nama,
 * ukuran label) — dipakai sebagai nilai default pada kunjungan berikutnya.
 * Kolom/baris di-clamp terhadap preset ukuran aktif oleh pemanggil
 * (batas maks berbeda per ukuran pas foto).
 */

const SETTINGS_KEY = "printifya.auto-layout.settings";

export interface LayoutSettings {
  cols: number;
  rows: number;
  marginCm: number;
  showLabels: boolean;
  labelSize: string; // "small" | "medium" | "large"
}

const LABEL_SIZES = ["small", "medium", "large"];

export function loadLayoutSettings(): Partial<LayoutSettings> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return null;
    const p = JSON.parse(raw) as Partial<LayoutSettings>;
    return {
      cols: typeof p.cols === "number" ? p.cols : undefined,
      rows: typeof p.rows === "number" ? p.rows : undefined,
      marginCm: typeof p.marginCm === "number" ? p.marginCm : undefined,
      showLabels:
        typeof p.showLabels === "boolean" ? p.showLabels : undefined,
      labelSize:
        typeof p.labelSize === "string" && LABEL_SIZES.includes(p.labelSize)
          ? p.labelSize
          : undefined,
    };
  } catch {
    return null;
  }
}

export function saveLayoutSettings(s: LayoutSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Hapus kunci localStorage milik modul ini. */
export function clearLayoutSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // abaikan
  }
}
