/**
 * Penyimpanan opsi Background Removal ke localStorage (pola sama dengan
 * storage.ts di Template Surat): kunci ber-prefix `printifya.` dan akses
 * dibungkus try/catch (storage bisa penuh / tidak tersedia).
 *
 * Yang disimpan:
 * - Opsi segmen (padanan rembg): post-process mask, alpha matting, erode size
 *   — dipakai sebagai nilai default pada kunjungan berikutnya.
 * - Awalan label terusan ke Auto Layout.
 */

export interface BgSegOptions {
  postProcess: boolean;
  matting: boolean;
  erodeSize: number;
}

const SEG_KEY = "printifya.bg-removal.seg-opts";
const PREFIX_KEY = "printifya.bg-removal.layout-prefix";

const DEFAULTS: BgSegOptions = {
  postProcess: true,
  matting: false,
  erodeSize: 10,
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage penuh / tidak tersedia — abaikan
  }
}

/** Baca opsi segmen tersimpan (dengan fallback ke default rembg). */
export function loadSegOptions(): BgSegOptions {
  const p = read<Partial<BgSegOptions>>(SEG_KEY);
  if (!p) return { ...DEFAULTS };
  return {
    postProcess:
      typeof p.postProcess === "boolean" ? p.postProcess : DEFAULTS.postProcess,
    matting: typeof p.matting === "boolean" ? p.matting : DEFAULTS.matting,
    erodeSize:
      typeof p.erodeSize === "number"
        ? Math.min(30, Math.max(0, Math.round(p.erodeSize)))
        : DEFAULTS.erodeSize,
  };
}

export function saveSegOptions(opts: BgSegOptions): void {
  write(SEG_KEY, opts);
}

/** Baca awalan label tersimpan; fallback "bg-". */
export function loadLayoutPrefix(): string {
  return read<string>(PREFIX_KEY) ?? "bg-";
}

export function saveLayoutPrefix(prefix: string): void {
  write(PREFIX_KEY, prefix);
}

/** Hapus semua kunci localStorage milik modul ini sekaligus. */
export function clearBgOptions(): void {
  try {
    localStorage.removeItem(SEG_KEY);
    localStorage.removeItem(PREFIX_KEY);
  } catch {
    // abaikan
  }
}
