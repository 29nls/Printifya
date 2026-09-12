/**
 * Penyimpanan ber-versi untuk data yang ditulis pengguna (draf surat, riwayat
 * surat, daftar printer jaringan).
 *
 * Dua masalah yang diatasi:
 *
 * 1. **Bentuk data berubah antar rilis.** Validator lama mengembalikan
 *    `undefined` untuk field yang tidak dikenali, lalu pemanggil memakai
 *    default — data pengguna hilang tanpa jejak. Envelope versi + rantai
 *    migrasi membuat perubahan bentuk bisa dinaikkan (migrate forward).
 * 2. **Kegagalan tulis ditelan.** `saveJSON` menangkap semua error dan
 *    mengembalikan `void`, sehingga pemanggil tidak bisa membedakan berhasil
 *    dari gagal dan UI bisa melaporkan "tersimpan" padahal tidak.
 *    `writeVersioned` mengembalikan hasil yang bisa gagal.
 *
 * Envelope di disk: `{ "v": <number>, "d": <payload> }`. Nilai yang BUKAN
 * envelope dianggap data lama versi 1 — jadi tidak ada penanda migrasi
 * terpisah yang harus dijaga sinkron. Kunci tetap sama seperti sebelumnya.
 *
 * Migrasi WAJIB sinkron dan total (tidak melempar). Semua pemanggil membaca di
 * dalam initializer `useState` atau efek, jadi rantai async akan memaksa
 * setiap call site masuk ke state loading.
 *
 * Nilai yang dimigrasi TIDAK ditulis balik otomatis — lihat `readVersioned`.
 */

import { loadJSON } from "./prefsStorage";

/** Ubah payload dari versi N ke N+1. Total: tidak boleh melempar. */
export type Migration = (input: unknown) => unknown;

export interface VersionedSpec<T> {
  /** Kunci localStorage (konvensi: ber-prefix `printifya.`). */
  key: string;
  /** Versi skema saat ini. */
  version: number;
  /** Indeks i memigrasi v(i+1) -> v(i+2). Panjangnya harus `version - 1`. */
  migrations: Migration[];
  /** Gerbang bentuk akhir; mengembalikan `null` untuk menolak. */
  validate: (value: unknown) => T | null;
}

export type ReadResult<T> =
  /** Tidak ada data tersimpan (pengguna baru). */
  | { status: "empty"; value: null }
  /** Data sudah berada di versi saat ini. */
  | { status: "current"; value: T }
  /** Data lama berhasil dimigrasi; `previous` = payload sebelum migrasi. */
  | { status: "migrated"; value: T; from: number; previous: unknown }
  /** Data ditulis versi aplikasi yang LEBIH BARU — jangan ditimpa. */
  | { status: "future"; value: null; found: number }
  /** Storage tidak diubah; pemanggil jatuh ke default dan memberi tahu. */
  | {
      status: "invalid";
      value: null;
      reason: "migration-failed" | "validation-failed";
    };

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "quota" | "unavailable" };

interface Envelope {
  v: number;
  d: unknown;
}

/**
 * Envelope dikenali dari field `v` numerik pada objek non-array. Tidak ada
 * payload saat ini yang punya field `v`, jadi data lama tidak pernah salah
 * dikenali. Bila kelak payload menambah field bernama `v`, versi skema harus
 * dinaikkan dan bentrokan itu ditangani di rantai migrasi.
 */
function isEnvelope(raw: unknown): raw is Envelope {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return false;
  }
  const v = (raw as { v?: unknown }).v;
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/**
 * Baca nilai ber-versi.
 *
 * Nilai hasil migrasi sengaja TIDAK ditulis balik di sini: penulisan saat
 * pembacaan berarti mengubah storage di dalam render/efek, dan kegagalannya
 * tidak terlihat. Nilai hasil migrasi dipersist saat pengguna menyimpan lagi.
 */
export function readVersioned<T>(spec: VersionedSpec<T>): ReadResult<T> {
  const raw = loadJSON<unknown>(spec.key);
  if (raw === null) return { status: "empty", value: null };

  const envelope = isEnvelope(raw);
  // Data lama ditulis tanpa envelope -> versi 1.
  const from = envelope ? raw.v : 1;
  const payload: unknown = envelope ? raw.d : raw;

  // Data dari versi aplikasi yang lebih baru: jangan migrasi, jangan tulis.
  // Ini yang mencegah build lama menimpa data build baru dengan default.
  if (from > spec.version) {
    return { status: "future", value: null, found: from };
  }

  let migrated = payload;
  try {
    for (let v = from; v < spec.version; v++) {
      const step = spec.migrations[v - 1];
      if (!step) {
        throw new Error(`Migrasi v${v} -> v${v + 1} tidak terdaftar.`);
      }
      migrated = step(migrated);
    }
  } catch {
    return { status: "invalid", value: null, reason: "migration-failed" };
  }

  let validated: T | null;
  try {
    validated = spec.validate(migrated);
  } catch {
    return { status: "invalid", value: null, reason: "validation-failed" };
  }
  if (validated === null) {
    return { status: "invalid", value: null, reason: "validation-failed" };
  }

  if (from === spec.version) return { status: "current", value: validated };
  return { status: "migrated", value: validated, from, previous: payload };
}

/**
 * Kode kuota berbeda antar browser: Chromium `QuotaExceededError` (kode 22),
 * Firefox `NS_ERROR_DOM_QUOTA_REACHED` (kode 1014). Keduanya berarti "storage
 * penuh", yang perlu dibedakan dari "storage tidak tersedia" (mode privat,
 * storage dimatikan) karena pesan ke pengguna berbeda.
 */
function isQuotaError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const { name, code } = err as { name?: unknown; code?: unknown };
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    code === 22 ||
    code === 1014
  );
}

/** Tulis nilai sebagai envelope versi saat ini. Tidak pernah melempar. */
export function writeVersioned<T>(
  spec: VersionedSpec<T>,
  value: T
): WriteResult {
  let serialized: unknown;
  try {
    serialized = JSON.stringify({ v: spec.version, d: value });
  } catch {
    // Nilai tidak bisa diserialisasi (mis. struktur sirkular).
    return { ok: false, reason: "unavailable" };
  }
  if (typeof serialized !== "string") {
    return { ok: false, reason: "unavailable" };
  }

  try {
    localStorage.setItem(spec.key, serialized);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: isQuotaError(err) ? "quota" : "unavailable" };
  }
}

/**
 * Helper pengambil field untuk validator: kembalikan field bila bertipe sesuai,
 * selain itu `fallback`. Dipakai agar validator untuk interface lebar tetap
 * singkat dan mudah dibaca. Semua fungsi total (tidak melempar).
 */

export function pickString(
  source: unknown,
  key: string,
  fallback = ""
): string {
  if (typeof source !== "object" || source === null) return fallback;
  const v = (source as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

/** String bila berisi, selain itu `null` (string kosong dinormalkan ke null). */
export function pickNullableString(source: unknown, key: string): string | null {
  if (typeof source !== "object" || source === null) return null;
  const v = (source as Record<string, unknown>)[key];
  return typeof v === "string" && v !== "" ? v : null;
}

/** Number finite; selain itu `fallback`. */
export function pickNumber(
  source: unknown,
  key: string,
  fallback: number
): number {
  if (typeof source !== "object" || source === null) return fallback;
  const v = (source as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Boolean; selain itu `fallback`. */
export function pickBoolean(
  source: unknown,
  key: string,
  fallback: boolean
): boolean {
  if (typeof source !== "object" || source === null) return fallback;
  const v = (source as Record<string, unknown>)[key];
  return typeof v === "boolean" ? v : fallback;
}
