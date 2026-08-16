/**
 * Kontrak pesan worker pipeline per-frame (faceWorker.ts). Types-only — impor
 * dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Dua jenis pesan: "processFrame" (deteksi wajah + enhancePixels +
 * temporalBlend pada satu frame; piksel masuk/keluar via transfer, tanpa salin)
 * dan "reset" (kosongkan frame sebelumnya `prev` — dipanggil tiap awal run agar
 * koherensi temporal tidak bocor antar video/run).
 */
import type { FaceEnhanceParams } from "../face-enhance/faceEnhance";

/** Permintaan proses satu frame. `pixels` = RGBA w×h (ArrayBuffer, dikirim
 *  via transfer — buffer sisi pengirim ter-detach). `temporal` = kekuatan
 *  koherensi temporal (0..100); `prev` dipegang worker secara internal. */
export type FaceWorkerRequest =
  | {
      type: "processFrame";
      id: number;
      pixels: ArrayBuffer;
      w: number;
      h: number;
      params: FaceEnhanceParams;
      temporal: number;
    }
  | { type: "reset"; id: number };

/** FaceWorkerRequest tanpa `id` (id diisi postFaceWorker di main thread). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
export type FaceWorkerRequestNoId = DistributiveOmit<FaceWorkerRequest, "id">;

/** Balasan (type mengikuti permintaan). "processFrame" mengembalikan piksel
 *  hasil (ArrayBuffer via transfer) + status deteksi wajah. */
export type FaceWorkerResponse =
  | {
      type: "processFrame";
      id: number;
      ok: true;
      pixels: ArrayBuffer;
      faceDetected: boolean;
    }
  | { type: "processFrame"; id: number; ok: false; error: string }
  | { type: "reset"; id: number; ok: true };
