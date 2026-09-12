/**
 * Penyimpanan draf & riwayat surat.
 *
 * Kunci ber-versi lewat `versionedStore` (envelope `{v,d}` + rantai migrasi):
 *
 * - `printifya.letter-draft`  — v2, migrasi v1 membuang logo yang kebesaran.
 * - `printifya.letter-archive`— v2, migrasi v1 membuang logo yang kebesaran
 *   lalu memangkas daftar agar muat anggaran byte.
 *
 * `printifya.letter-paper` tetap memakai `loadString`/`saveString` tanpa
 * envelope: nilainya string mentah (id ukuran kertas), bukan JSON, sehingga
 * `JSON.parse` akan gagal dan nilai lama hilang bila dipindah ke envelope.
 * Ukuran kertas juga preferensi (fallback A4 sudah benar), bukan konten yang
 * ditulis pengguna — jadi tidak perlu versi.
 *
 * Semua penulisan mengembalikan `WriteResult` supaya pemanggil bisa membedakan
 * berhasil dari gagal dan tidak melaporkan "tersimpan" saat storage penuh.
 */

import type { LetterFields } from "./letterHtml";
import { loadString, removeKeys, saveString } from "../../shared/prefsStorage";
import {
  pickNumber,
  pickString,
  pickNullableString,
  pruneByBudget,
  readVersioned,
  writeVersioned,
  type VersionedSpec,
  type WriteResult,
} from "../../shared/versionedStore";

export interface ArchiveEntry {
  id: string;
  savedAt: string; // ISO
  data: LetterFields;
}

const DRAFT_KEY = "printifya.letter-draft";
const ARCHIVE_KEY = "printifya.letter-archive";
const PAPER_KEY = "printifya.letter-paper";

/** Batas jumlah entri riwayat. */
export const MAX_ARCHIVE = 50;
/** Anggaran ukuran total riwayat. localStorage dibagi bersama 21 kunci (~5 MB). */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;
/**
 * Logo di atas ambang ini dibuang oleh migrasi v1->v2. Unggahan baru
 * di-downscale saat dipilih (≤512 px, JPEG 0.85) sehingga jauh di bawah ambang
 * ini — ambang hanya menyasar data lama.
 */
export const MAX_LOGO_CHARS = 400_000;

const DRAFT_VERSION = 2;
const ARCHIVE_VERSION = 2;

/** Id entri baru: waktu + akhiran acak (pola sama dengan modul lain). */
export function makeEntryId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Validasi bentuk surat. Tingkat objek bersifat menolak (bukan objek = tidak
 * terbaca), tingkat field bersifat koersi: field yang hilang/berubah tipe
 * jatuh ke default supaya perubahan bentuk tidak membuang seluruh surat.
 */
function validateLetterFields(value: unknown): LetterFields | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return {
    instansi: pickString(value, "instansi"),
    alamat: pickString(value, "alamat"),
    logo: pickNullableString(value, "logo"),
    kode: pickString(value, "kode"),
    seq: pickNumber(value, "seq", 1),
    tanggal: pickString(value, "tanggal"),
    lampiran: pickString(value, "lampiran"),
    perihal: pickString(value, "perihal"),
    kepada: pickString(value, "kepada"),
    isi: pickString(value, "isi"),
    penutup: pickString(value, "penutup"),
    nama: pickString(value, "nama"),
    jabatan: pickString(value, "jabatan"),
  };
}

function hasOversizedLogo(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const logo = (value as { logo?: unknown }).logo;
  return typeof logo === "string" && logo.length > MAX_LOGO_CHARS;
}

/** Buang logo yang melebihi batas; field lain tidak disentuh. */
function stripOversizedLogo(value: unknown): unknown {
  if (!hasOversizedLogo(value)) return value;
  return { ...(value as Record<string, unknown>), logo: null };
}

/**
 * Pangkas daftar agar muat `MAX_ARCHIVE` entri DAN `MAX_ARCHIVE_BYTES`.
 * Entri terbaru dipertahankan (pemanggil menaruh yang terbaru di depan).
 */
export function pruneArchive(entries: ArchiveEntry[]): ArchiveEntry[] {
  return pruneByBudget(entries, MAX_ARCHIVE, MAX_ARCHIVE_BYTES);
}

/** Migrasi v1->v2 draf: buang logo yang kebesaran. */
function migrateDraft(input: unknown): unknown {
  return stripOversizedLogo(input);
}

/** Migrasi v1->v2 riwayat: buang logo kebesaran lalu pangkas agar muat. */
function migrateArchive(input: unknown): unknown {
  if (!Array.isArray(input)) return input;
  const stripped = input.map((entry) => {
    if (typeof entry !== "object" || entry === null) return entry;
    const data = (entry as { data?: unknown }).data;
    const nextData = stripOversizedLogo(data);
    if (nextData === data) return entry;
    return { ...(entry as Record<string, unknown>), data: nextData };
  });
  return pruneByBudget(stripped, MAX_ARCHIVE, MAX_ARCHIVE_BYTES);
}

const DRAFT_SPEC: VersionedSpec<LetterFields> = {
  key: DRAFT_KEY,
  version: DRAFT_VERSION,
  migrations: [migrateDraft],
  validate: validateLetterFields,
};

/**
 * Riwayat divalidasi bertingkat: spec hanya memastikan bentuknya array,
 * pemanggil menyaring entri satu per satu supaya satu entri rusak tidak
 * membuang seluruh riwayat.
 */
const ARCHIVE_SPEC: VersionedSpec<unknown[]> = {
  key: ARCHIVE_KEY,
  version: ARCHIVE_VERSION,
  migrations: [migrateArchive],
  validate: (value) => (Array.isArray(value) ? value : null),
};

export interface DraftLoad {
  fields: LetterFields | null;
  /** Logo dibuang oleh migrasi (data lama saja). */
  removedLogo: boolean;
  /** Data ditulis versi aplikasi lebih baru — jangan menimpa. */
  locked: boolean;
  /** Ada data tersimpan tapi tidak bisa dibaca (bukan pengguna baru). */
  unreadable: boolean;
}

export function loadDraft(): DraftLoad {
  const result = readVersioned(DRAFT_SPEC);
  switch (result.status) {
    case "empty":
      return { fields: null, removedLogo: false, locked: false, unreadable: false };
    case "current":
      return { fields: result.value, removedLogo: false, locked: false, unreadable: false };
    case "migrated":
      return {
        fields: result.value,
        removedLogo: hasOversizedLogo(result.previous),
        locked: false,
        unreadable: false,
      };
    case "future":
      return { fields: null, removedLogo: false, locked: true, unreadable: false };
    case "invalid":
      // Ada data tapi tidak terbaca: bedakan dari pengguna baru supaya UI
      // tidak menyajikan surat kosong seolah tidak pernah ada draf.
      return { fields: null, removedLogo: false, locked: false, unreadable: true };
  }
}

export function saveDraft(data: LetterFields): WriteResult {
  return writeVersioned(DRAFT_SPEC, data);
}

export function clearDraft(): void {
  removeKeys(DRAFT_KEY);
}

/** Entri riwayat yang lolos validasi bentuk. */
function validateArchiveEntry(value: unknown, index: number): ArchiveEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const data = validateLetterFields(raw.data);
  // Isi surat tidak terbaca -> entri tidak bisa ditampilkan maupun dimuat.
  if (data === null) return null;
  return {
    // Id/tanggal yang hilang diperbaiki, bukan dijadikan alasan membuang
    // surat — kontennya masih utuh dan itu yang berharga.
    id: pickString(raw, "id") || `legacy-${index}`,
    savedAt: pickString(raw, "savedAt"),
    data,
  };
}

function countOversizedLogos(previous: unknown): number {
  if (!Array.isArray(previous)) return hasOversizedLogo(previous) ? 1 : 0;
  return previous.filter((entry) =>
    typeof entry === "object" && entry !== null
      ? hasOversizedLogo((entry as { data?: unknown }).data)
      : false
  ).length;
}

export interface ArchiveLoad {
  entries: ArchiveEntry[];
  /** Entri dibuang karena isinya tidak terbaca. */
  dropped: number;
  /** Entri dibuang karena anggaran byte saat migrasi. */
  evicted: number;
  /** Logo dibuang oleh migrasi (data lama saja). */
  removedLogos: number;
  /** Data ditulis versi aplikasi lebih baru — jangan menimpa. */
  locked: boolean;
  /** Ada data tersimpan tapi tidak bisa dibaca. */
  unreadable: boolean;
}

const EMPTY_ARCHIVE: ArchiveLoad = {
  entries: [],
  dropped: 0,
  evicted: 0,
  removedLogos: 0,
  locked: false,
  unreadable: false,
};

export function loadArchive(): ArchiveLoad {
  const result = readVersioned(ARCHIVE_SPEC);
  if (result.status === "empty") return EMPTY_ARCHIVE;
  if (result.status === "future") {
    return { ...EMPTY_ARCHIVE, locked: true };
  }
  if (result.status === "invalid") {
    return { ...EMPTY_ARCHIVE, unreadable: true };
  }

  const entries: ArchiveEntry[] = [];
  result.value.forEach((raw, index) => {
    const entry = validateArchiveEntry(raw, index);
    if (entry) entries.push(entry);
  });

  const migrated = result.status === "migrated";
  const previous = migrated ? result.previous : null;
  // `pruneRaw` memangkas saat migrasi, jadi selisih panjang menunjukkan berapa
  // entri yang dibuang karena anggaran byte (bukan karena isinya rusak).
  const evicted =
    previous !== null && Array.isArray(previous)
      ? Math.max(0, previous.length - result.value.length)
      : 0;

  return {
    entries,
    dropped: result.value.length - entries.length,
    evicted,
    removedLogos: previous === null ? 0 : countOversizedLogos(previous),
    locked: false,
    unreadable: false,
  };
}

/** Simpan tepat apa yang diberikan; panggil `pruneArchive` lebih dulu. */
export function saveArchive(entries: ArchiveEntry[]): WriteResult {
  return writeVersioned(ARCHIVE_SPEC, entries);
}

/** Ukuran kertas terakhir yang dipilih pengguna (id; default A4). */
export function loadPaperId(): string | null {
  return loadString(PAPER_KEY, null);
}

export function savePaperId(id: string): void {
  saveString(PAPER_KEY, id);
}

/** Hapus semua kunci localStorage milik modul ini (draf + riwayat + kertas). */
export function clearAllStorage(): void {
  removeKeys(DRAFT_KEY, ARCHIVE_KEY, PAPER_KEY);
}
