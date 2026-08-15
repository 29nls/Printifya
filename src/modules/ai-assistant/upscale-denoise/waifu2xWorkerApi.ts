import type { FormatStat, ProcessOptions, OutFormat } from "./waifu2x";

/**
 * Kontrak pesan worker pipeline (waifu2x.worker.ts). Types-only — impor
 * dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 * Dua jenis pekerjaan: "process" (pipeline upscale/denoise/TTA) dan
 * "compare" (perbandingan format PNG/WebP/JPG + PSNR) — keduanya dijalankan
 * di worker agar thread utama tidak pernah melakukan kerja berat.
 */

/** Permintaan: satu gambar + opsi pipeline. `bitmap` dikirim via transfer. */
export type Waifu2xWorkerRequest =
  | {
      type: "process";
      id: number;
      bitmap: ImageBitmap;
      options: ProcessOptions;
      format: OutFormat;
      /** Kualitas sebagai fraksi (0–1) untuk encode output. */
      quality: number;
    }
  | {
      type: "compare";
      id: number;
      bitmap: ImageBitmap;
      /** Kualitas sebagai persen integer (50–100); dibagi 100 di compareFormats. */
      quality: number;
    };

/** Waifu2xWorkerRequest tanpa `id` (id diisi postWorker di main thread).
 *  Distributive Omit agar union process/compare tetap terjaga tipenya. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type Waifu2xWorkerRequestNoId = DistributiveOmit<
  Waifu2xWorkerRequest,
  "id"
>;

/** Balasan (type mengikuti permintaan). "process" mengembalikan blob hasil
 *  (URL tampilan/unduh) + ImageBitmap hasil (referensi perbandingan format,
 *  dikirim via transfer); "compare" mengembalikan statistik format. */
export type Waifu2xWorkerResponse =
  | {
      type: "process";
      id: number;
      ok: true;
      blob: Blob;
      width: number;
      height: number;
      bitmap: ImageBitmap;
    }
  | { type: "compare"; id: number; ok: true; stats: FormatStat[] }
  | { type: "process"; id: number; ok: false; error: string }
  | { type: "compare"; id: number; ok: false; error: string };
