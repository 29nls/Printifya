/**
 * Penyimpanan riwayat cetak (`printifya.printHistory`).
 *
 * **Versi 2** — payload `{ records, blobs }`:
 *
 * - `records` — entri riwayat; kecil (nama, kertas, jumlah lembar, waktu,
 *   status) dan opsional menunjuk satu blob lewat `htmlKey`.
 * - `blobs` — HTML cetak siap kirim untuk aksi "Cetak lagi", dikunci per isi.
 *   Dipisah dari entri supaya mencetak dokumen yang sama berkali-kali tidak
 *   menggandakan isinya: HTML identik memakai satu blob bersama.
 *
 * Versi 1 menyimpan array entri saja, tanpa aksi cetak ulang; migrasinya
 * membungkus array itu ke bentuk baru sehingga entri lama tetap terbaca
 * (tanpa cetak ulang, karena isinya memang belum pernah disimpan).
 *
 * Dua anggaran terpisah: `MAX_HISTORY_BYTES` untuk entri dan
 * `MAX_REPRINT_TOTAL_CHARS` untuk HTML tersimpan. Cetakan berbasis foto
 * (Pas Foto, Auto Layout, Printer Lokal) membawa data URL gambar sehingga
 * selalu melebihi `MAX_REPRINT_CHARS`; entrinya tetap tercatat tetapi tanpa
 * aksi cetak ulang. Jadi yang menentukan bisa-tidaknya cetak ulang adalah
 * ukuran hasil cetak, bukan daftar nama modul yang harus dijaga sinkron.
 *
 * Berbeda dari draf surat dan daftar printer — konten yang ditulis pengguna —
 * riwayat cetak adalah **log**. Kegagalan mencatat karena itu tidak pernah
 * ditampilkan sebagai error ke pengguna: cetakan yang berhasil tetapi gagal
 * dicatat tidak boleh membuat alur cetak terlihat gagal. Pemanggil alur cetak
 * boleh mengabaikan `WriteResult`; halaman Riwayat Cetak tetap memakainya untuk
 * memberi tahu saat penyimpanan penuh.
 *
 * Semua akses lewat helper bersama dan tidak pernah melempar.
 */

import {
  pickNumber,
  pickString,
  pruneByBudget,
  readVersioned,
  writeVersioned,
  type VersionedSpec,
  type WriteResult,
} from "../shared/versionedStore";

export interface PrintRecord {
  id: string;
  name: string;
  copies: number;
  paperSize: string;
  timestamp: number;
  status: "done" | "failed";
  /** Menunjuk entri di `blobs`; absen bila hasil cetak tidak disimpan. */
  htmlKey?: string;
}

const STORE_KEY = "printifya.printHistory";
const STORE_VERSION = 2;

/** Batas jumlah entri riwayat. */
export const MAX_HISTORY = 100;
/** Anggaran ukuran entri riwayat (tanpa HTML tersimpan). */
export const MAX_HISTORY_BYTES = 256 * 1024;
/** Ukuran maksimum satu HTML cetak agar disimpan untuk cetak ulang. */
export const MAX_REPRINT_CHARS = 160_000;
/** Anggaran total seluruh HTML cetak tersimpan. */
export const MAX_REPRINT_TOTAL_CHARS = 320_000;

/** Bentuk payload mentah setelah gerbang bentuk di `HISTORY_SPEC`. */
interface LoosePayload {
  records: unknown[];
  blobs: Record<string, unknown>;
}

function validatePayload(value: unknown): LoosePayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const records = (value as { records?: unknown }).records;
  if (!Array.isArray(records)) return null;
  const blobsRaw = (value as { blobs?: unknown }).blobs;
  const blobs: Record<string, unknown> =
    typeof blobsRaw === "object" && blobsRaw !== null && !Array.isArray(blobsRaw)
      ? (blobsRaw as Record<string, unknown>)
      : {};
  return { records, blobs };
}

/** Migrasi v1 -> v2: array entri dibungkus, tanpa blob (belum ada yang disimpan). */
function migrateV1ToV2(input: unknown): unknown {
  return Array.isArray(input) ? { records: input, blobs: {} } : input;
}

const HISTORY_SPEC: VersionedSpec<LoosePayload> = {
  key: STORE_KEY,
  version: STORE_VERSION,
  migrations: [migrateV1ToV2],
  validate: validatePayload,
};

/**
 * Validasi satu entri. Entri tanpa nama atau waktu tidak bisa ditampilkan
 * bermakna, jadi dibuang; field lain yang hilang/salah tipe jatuh ke default
 * supaya perubahan bentuk tidak membuang seluruh riwayat.
 */
function validateRecord(value: unknown, index: number): PrintRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const name = pickString(value, "name").trim();
  const timestamp = pickNumber(value, "timestamp", 0);
  if (name === "" || timestamp <= 0) return null;
  const htmlKey = pickString(value, "htmlKey");
  return {
    id: pickString(value, "id") || `legacy-${index}`,
    name,
    copies: Math.max(1, Math.trunc(pickNumber(value, "copies", 1))),
    paperSize: pickString(value, "paperSize") || "A4",
    timestamp,
    status: pickString(value, "status") === "failed" ? "failed" : "done",
    ...(htmlKey ? { htmlKey } : {}),
  };
}

/**
 * Buang blob yang tidak dirujuk entri mana pun, dan hormati anggaran total.
 * Entri terbaru diproses lebih dulu sehingga dokumen terbaru yang bertahan saat
 * anggaran habis.
 */
function collectBlobs(
  records: PrintRecord[],
  blobs: Record<string, string>
): Record<string, string> {
  const used: Record<string, string> = {};
  let chars = 0;
  for (const record of records) {
    const key = record.htmlKey;
    if (!key || used[key] !== undefined) continue;
    const html = blobs[key];
    if (typeof html !== "string") continue;
    if (chars + html.length > MAX_REPRINT_TOTAL_CHARS) continue;
    used[key] = html;
    chars += html.length;
  }
  return used;
}

interface HistoryState {
  records: PrintRecord[];
  blobs: Record<string, string>;
  dropped: number;
  locked: boolean;
  unreadable: boolean;
}

const EMPTY_STATE: HistoryState = {
  records: [],
  blobs: {},
  dropped: 0,
  locked: false,
  unreadable: false,
};

/** Baca mentah: entri + blob + kondisi data. Tidak diekspor. */
function readHistory(): HistoryState {
  const result = readVersioned(HISTORY_SPEC);
  if (result.status === "empty") return EMPTY_STATE;
  if (result.status === "future") return { ...EMPTY_STATE, locked: true };
  if (result.status === "invalid") return { ...EMPTY_STATE, unreadable: true };

  const records: PrintRecord[] = [];
  result.value.records.forEach((raw, index) => {
    const record = validateRecord(raw, index);
    if (record) records.push(record);
  });

  const stored: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.value.blobs)) {
    if (typeof value === "string") stored[key] = value;
  }

  return {
    records,
    // Anggaran diterapkan saat baca juga, supaya tampilan dan simpan konsisten
    // meski berkas tersimpan melebihi anggaran versi sekarang.
    blobs: collectBlobs(records, stored),
    dropped: result.value.records.length - records.length,
    locked: false,
    unreadable: false,
  };
}

export interface PrintHistoryLoad {
  records: PrintRecord[];
  /** Id entri yang hasil cetaknya tersimpan dan bisa dicetak ulang. */
  reprintable: string[];
  /** Entri dibuang karena namanya kosong atau waktunya tak valid. */
  dropped: number;
  /** Data ditulis versi aplikasi lebih baru — jangan menimpa. */
  locked: boolean;
  /** Ada data tersimpan tapi tidak bisa dibaca. */
  unreadable: boolean;
}

export function loadPrintHistory(): PrintHistoryLoad {
  const state = readHistory();
  return {
    records: state.records,
    reprintable: state.records
      .filter((r) => r.htmlKey !== undefined && state.blobs[r.htmlKey] !== undefined)
      .map((r) => r.id),
    dropped: state.dropped,
    locked: state.locked,
    unreadable: state.unreadable,
  };
}

function writeHistory(
  records: PrintRecord[],
  blobs: Record<string, string>
): WriteResult {
  return writeVersioned(HISTORY_SPEC, { records, blobs });
}

/**
 * Simpan tepat apa yang diberikan; panggil `pruneHistory` lebih dulu.
 * `blobs` dikosongkan secara default supaya menghapus riwayat juga membuang
 * HTML tersimpannya, bukan meninggalkan sampah tak terpakai.
 */
export function savePrintHistory(
  records: PrintRecord[],
  blobs: Record<string, string> = {}
): WriteResult {
  return writeHistory(records, collectBlobs(records, blobs));
}

/** Pangkas agar muat `MAX_HISTORY` entri DAN `MAX_HISTORY_BYTES`. */
export function pruneHistory(records: PrintRecord[]): PrintRecord[] {
  return pruneByBudget(records, MAX_HISTORY, MAX_HISTORY_BYTES);
}

/** HTML cetak tersimpan untuk satu entri; `null` bila tidak ada. */
export function loadReprintHtml(record: PrintRecord): string | null {
  const key = record.htmlKey;
  if (!key) return null;
  const html = readHistory().blobs[key];
  return typeof html === "string" ? html : null;
}

/**
 * Kunci blob untuk `html`. Isi yang identik memakai ulang kunci yang ada, jadi
 * mencetak dokumen yang sama berkali-kali hanya menyimpan satu salinan.
 * Pencocokan memakai perbandingan persis, bukan hash, supaya tidak ada risiko
 * tabrakan yang bisa menampilkan dokumen yang salah saat cetak ulang.
 */
function blobKeyFor(html: string, blobs: Record<string, string>): string {
  for (const [key, value] of Object.entries(blobs)) {
    if (value === html) return key;
  }
  const base = `d${html.length.toString(36)}x${Date.now().toString(36)}`;
  let key = base;
  let n = 1;
  while (blobs[key] !== undefined) key = `${base}-${n++}`;
  return key;
}

export interface RecordPrintInput {
  name: string;
  paperSize: string;
  /** Cetak berhasil DIMULAI (dialog terbuka / job terkirim). */
  ok: boolean;
  /** Jumlah lembar; default 1 karena dialog cetak browser yang menentukan. */
  copies?: number;
  /**
   * HTML cetak siap kirim. Disimpan hanya bila muat `MAX_REPRINT_CHARS`;
   * selebihnya entri tetap dicatat tetapi tanpa aksi cetak ulang.
   */
  html?: string;
}

/**
 * Catat satu aksi cetak; riwayat terbaru di depan. `ok` berarti aksi cetak
 * berhasil dimulai, bukan jaminan halaman keluar dari printer.
 *
 * Saat data tersimpan milik versi aplikasi yang lebih baru (`locked`), tidak
 * ada yang ditulis dan hasilnya `unavailable`.
 */
export function recordPrint(input: RecordPrintInput): WriteResult {
  const current = readHistory();
  if (current.locked) return { ok: false, reason: "unavailable" };

  const blobs = { ...current.blobs };
  const html = input.html;
  let htmlKey: string | undefined;
  if (typeof html === "string" && html.length > 0 && html.length <= MAX_REPRINT_CHARS) {
    htmlKey = blobKeyFor(html, blobs);
    blobs[htmlKey] = html;
  }

  const record: PrintRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: input.name.trim() || "Tanpa nama",
    copies: Math.max(1, Math.trunc(input.copies ?? 1)),
    paperSize: input.paperSize.trim() || "A4",
    timestamp: Date.now(),
    status: input.ok ? "done" : "failed",
    ...(htmlKey ? { htmlKey } : {}),
  };

  const records = pruneHistory([record, ...current.records]);
  return writeHistory(records, collectBlobs(records, blobs));
}
