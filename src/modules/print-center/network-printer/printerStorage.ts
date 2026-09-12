/**
 * Penyimpanan daftar printer jaringan.
 *
 * Kunci `printifya.network-printers` kini ber-versi lewat `versionedStore`
 * (envelope `{v,d}` + rantai migrasi). Versi 1 karena belum ada perubahan
 * bentuk, jadi rantai migrasi sengaja kosong — envelope tetap ditulis supaya
 * perubahan bentuk berikutnya punya titik mula.
 *
 * Sebelumnya validator hanya memeriksa `Array.isArray`, sehingga entri dengan
 * host kosong atau port di luar rentang ikut masuk dan gagal saat dipakai
 * mencetak. Sekarang entri divalidasi satu per satu.
 */

import {
  pickNumber,
  pickString,
  readVersioned,
  writeVersioned,
  type VersionedSpec,
  type WriteResult,
} from "../../shared/versionedStore";

export interface Printer {
  id: string;
  name: string;
  host: string;
  port: number;
  path: string;
}

const STORE_KEY = "printifya.network-printers";
const STORE_VERSION = 1;

/** Rentang port TCP yang valid. */
export const MIN_PORT = 1;
export const MAX_PORT = 65535;

/** Validasi satu entri printer; `null` berarti entri dibuang. */
export function validatePrinter(value: unknown): Printer | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const host = pickString(value, "host").trim();
  const port = pickNumber(value, "port", 631);
  // Host kosong atau port di luar rentang berarti entri tidak bisa dipakai
  // untuk mencetak, jadi lebih jujur dibuang daripada ditampilkan.
  if (host === "" || port < MIN_PORT || port > MAX_PORT) return null;
  const whole = Math.trunc(port);
  return {
    // Id/nama yang hilang diperbaiki, bukan alasan membuang konfigurasi.
    id: pickString(value, "id") || `legacy-${host}:${whole}`,
    name: pickString(value, "name") || host,
    host,
    port: whole,
    path: pickString(value, "path") || "/ipp/print",
  };
}

const PRINTERS_SPEC: VersionedSpec<unknown[]> = {
  key: STORE_KEY,
  version: STORE_VERSION,
  migrations: [],
  // Bentuk array diperiksa di sini; entri disaring per item di `loadPrinters`.
  validate: (value) => (Array.isArray(value) ? value : null),
};

export interface PrintersLoad {
  printers: Printer[];
  /** Entri dibuang karena konfigurasinya tidak valid. */
  dropped: number;
  /** Data ditulis versi aplikasi lebih baru — jangan menimpa. */
  locked: boolean;
  /** Ada data tersimpan tapi tidak bisa dibaca. */
  unreadable: boolean;
}

export function loadPrinters(): PrintersLoad {
  const result = readVersioned(PRINTERS_SPEC);
  if (result.status === "empty") {
    return { printers: [], dropped: 0, locked: false, unreadable: false };
  }
  if (result.status === "future") {
    return { printers: [], dropped: 0, locked: true, unreadable: false };
  }
  if (result.status === "invalid") {
    return { printers: [], dropped: 0, locked: false, unreadable: true };
  }

  const printers: Printer[] = [];
  for (const raw of result.value) {
    const printer = validatePrinter(raw);
    if (printer) printers.push(printer);
  }
  return {
    printers,
    dropped: result.value.length - printers.length,
    locked: false,
    unreadable: false,
  };
}

export function savePrinters(list: Printer[]): WriteResult {
  return writeVersioned(PRINTERS_SPEC, list);
}
