import type { FormatStat } from "./waifu2x";

/**
 * Status sesi tabel perbandingan format — model murni dari state komponen
 * (Upscale & Denoise). Dipisahkan dari React agar keputusan toggle bisa
 * diuji unit.
 */
export interface FormatSession {
  /** Id item yang panelnya sedang terbuka (null = tertutup). */
  openId: string | null;
  /** Id item yang sedang menghitung perbandingan formatnya (guard per-id). */
  loading: ReadonlySet<string>;
}

/** Bidang Item yang relevan untuk keputusan toggle (tipe struktural). */
export interface FormatToggleItem {
  id: string;
  /** Hasil perbandingan tersimpan (cache); undefined = belum dihitung. */
  formats?: FormatStat[] | null;
}

export type FormatToggleDecision =
  | { action: "close" }
  | { action: "cached" }
  | { action: "in-flight" }
  | { action: "compute" };

/**
 * Keputusan toggle tabel format — murni, tanpa efek samping. Menjaga dua
 * invarianta irisan performa:
 *
 * 1. Cache — hasil yang sudah dihitung tidak pernah dihitung ulang
 *    (`formats` tersimpan → "cached", panel langsung tampil).
 * 2. Guard per-id — komputasi tiap item hanya satu kali, bahkan bila item
 *    lain sedang menghitung (Set per-id, bukan flag tunggal; tanpa ini,
 *    klik A → B → A saat keduanya in-flight memulai komputasi duplikat).
 */
export function decideFormatToggle(
  item: FormatToggleItem,
  session: FormatSession
): FormatToggleDecision {
  if (session.openId === item.id) return { action: "close" };
  if (item.formats) return { action: "cached" };
  if (session.loading.has(item.id)) return { action: "in-flight" };
  return { action: "compute" };
}
