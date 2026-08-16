/**
 * Kontrak pesan worker Face Enhance (faceEnhance.worker.ts). Types-only —
 * impor dengan `import type` agar tidak ikut di-bundle ke chunk utama.
 *
 * Satu jenis pesan: "process" — jalankan pipeline full-res (restore wajah via
 * `applyFaceEnhance` + perbesaran `upscaleCanvas`) pada piksel RGBA yang
 * dikirim via transfer. Kotak wajah (`face`, ternormalisasi 0..1) dihitung di
 * thread utama (`detectFace` — murah, downscale ≤240 px) dan dikirim sebagai
 * data, sehingga hasil piksel identik dengan jalur `enhanceFace` lama.
 */
import type { FaceRegion } from "../../photo-studio/shared/faceDetect";
import type { FaceEnhanceParams } from "./faceEnhance";

/** Permintaan proses satu foto full-res. `pixels` = RGBA w×h (ArrayBuffer,
 *  dikirim via transfer — buffer sisi pengirim ter-detach). */
export type FaceEnhanceWorkerRequest = {
  type: "process";
  id: number;
  pixels: ArrayBuffer;
  w: number;
  h: number;
  /** Kotak wajah ternormalisasi hasil `detectFace` (null → koreksi global). */
  face: FaceRegion | null;
  params: FaceEnhanceParams;
  /** Faktor perbesaran setelah pemulihan (1/2/4). */
  upscale: number;
};

/** FaceEnhanceWorkerRequest tanpa `id` (id diisi postFaceEnhanceWorker). */
export type FaceEnhanceWorkerRequestNoId = Omit<FaceEnhanceWorkerRequest, "id">;

/** Balasan: Blob PNG hasil (encode `convertToBlob` juga berjalan di worker,
 *  jadi `toDataURL`/encode gambar besar tidak membekukan UI). */
export type FaceEnhanceWorkerResponse =
  | { type: "process"; id: number; ok: true; blob: Blob }
  | { type: "process"; id: number; ok: false; error: string };
