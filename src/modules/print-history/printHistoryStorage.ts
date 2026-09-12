/**
 * Penyimpanan riwayat cetak (`printifya.printHistory`).
 *
 * Ber-versi lewat `versionedStore` (envelope `{v,d}`), versi 1 dengan rantai
 * migrasi kosong: belum ada perubahan bentuk, dan envelope ditulis sekarang
 * supaya perubahan berikutnya punya titik mula.
 *
 * Berbeda dari draf surat dan daftar printer — konten yang ditulis pengguna —
 * riwayat cetak adalah **log**. Karena itu kegagalan mencatat tidak pernah
 * ditampilkan sebagai error ke pengguna: cetakan yang berhasil tetapi gagal
 * dicatat tidak boleh membuat alur cetak terlihat gagal. Pemanggil alur cetak
 * boleh mengabaikan `WriteResult`; halaman Riwayat Cetak tetap memakainya untuk
 * memberi tahu saat penyimpanan penuh.
 *
 * Sebelum ini modul memanggil `localStorage.setItem` langsung tanpa try/catch,
 * sehingga kuota penuh akan melempar ke dalam alur cetak. Sekarang semua akses
 * lewat helper bersama dan tidak pernah melempar.
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
}

const STORE_KEY = "printifya.printHistory";
const STORE_VERSION = 1;

/** Batas jumlah entri riwayat. */
export const MAX_HISTORY = 100;
/** Anggaran ukuran total riwayat. Entri kecil, jadi ini sangat longgar. */
export const MAX_HISTORY_BYTES = 256 * 1024;

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
  return {
    id: pickString(value, "id") || `legacy-${index}`,
    name,
    copies: Math.max(1, Math.trunc(pickNumber(value, "copies", 1))),
    paperSize: pickString(value, "paperSize") || "A4",
    timestamp,
    status: pickString(value, "status") === "failed" ? "failed" : "done",
  };
}

const HISTORY_SPEC: VersionedSpec<unknown[]> = {
  key: STORE_KEY,
  version: STORE_VERSION,
  migrations: [],
  // Bentuk array diperiksa di sini; entri disaring per item di `loadPrintHistory`.
  validate: (value) => (Array.isArray(value) ? value : null),
};

export interface PrintHistoryLoad {
  records: PrintRecord[];
  /** Entri dibuang karena namanya kosong atau waktunya tak valid. */
  dropped: number;
  /** Data ditulis versi aplikasi lebih baru — jangan menimpa. */
  locked: boolean;
  /** Ada data tersimpan tapi tidak bisa dibaca. */
  unreadable: boolean;
}

export function loadPrintHistory(): PrintHistoryLoad {
  const result = readVersioned(HISTORY_SPEC);
  if (result.status === "empty") {
    return { records: [], dropped: 0, locked: false, unreadable: false };
  }
  if (result.status === "future") {
    return { records: [], dropped: 0, locked: true, unreadable: false };
  }
  if (result.status === "invalid") {
    return { records: [], dropped: 0, locked: false, unreadable: true };
  }

  const records: PrintRecord[] = [];
  result.value.forEach((raw, index) => {
    const record = validateRecord(raw, index);
    if (record) records.push(record);
  });
  return {
    records,
    dropped: result.value.length - records.length,
    locked: false,
    unreadable: false,
  };
}

/** Simpan tepat apa yang diberikan; panggil `pruneHistory` lebih dulu. */
export function savePrintHistory(records: PrintRecord[]): WriteResult {
  return writeVersioned(HISTORY_SPEC, records);
}

/** Pangkas agar muat `MAX_HISTORY` entri DAN `MAX_HISTORY_BYTES`. */
export function pruneHistory(records: PrintRecord[]): PrintRecord[] {
  return pruneByBudget(records, MAX_HISTORY, MAX_HISTORY_BYTES);
}

/**
 * Catat satu aksi cetak. Riwayat terbaru di depan.
 *
 * `ok` berarti aksi cetak BERHASIL DIMULAI (dialog cetak terbuka, job terkirim)
 * — bukan jaminan halaman keluar dari printer, karena dialog cetak browser
 * menentukan hasil akhirnya.
 *
 * `copies` default 1 lembar: jumlah salinan sebenarnya ditentukan di dialog
 * cetak browser, jadi aplikasi tidak mengetahuinya.
 *
 * Saat data tersimpan milik versi aplikasi yang lebih baru (`locked`), tidak
 * ada yang ditulis dan hasilnya `unavailable` — riwayat tidak boleh menimpa
 * data build yang lebih baru.
 */
export function recordPrint(
  name: string,
  paperSize: string,
  ok: boolean,
  copies = 1
): WriteResult {
  const current = loadPrintHistory();
  if (current.locked) return { ok: false, reason: "unavailable" };

  const record: PrintRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || "Tanpa nama",
    copies: Math.max(1, Math.trunc(copies)),
    paperSize: paperSize.trim() || "A4",
    timestamp: Date.now(),
    status: ok ? "done" : "failed",
  };
  return savePrintHistory(pruneHistory([record, ...current.records]));
}
