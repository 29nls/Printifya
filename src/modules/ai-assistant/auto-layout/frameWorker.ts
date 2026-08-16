/**
 * Klien framing batch Auto Layout — SUMBER TUNGGAL untuk framing hidup
 * (efek preview) DAN ekspor/cetak (`ensureFreshFrames`), memakai pola worker
 * yang sama dengan modul AI lain (createWorkerClient).
 *
 * Desain (dari pengukuran): SEMUA kerja gambar (decode, cover-fit, bingkai
 * photobox, encode PNG, base64) terjadi di worker — thread utama hanya
 * fetch → Blob → post. Blob sumber (≈2 MB untuk JPEG) lebih ringan
 * di-klon daripada bitmap RGBA (24 MB untuk 3000×2000), dan satu blob per
 * permintaan yang diproses berurutan per worker menjaga memori tetap aman.
 * POOL kecil (2–3 worker) membagi batch sehingga wall time tidak lebih buruk
 * dari jalur serial lama. Fallback: `applyFrame` thread utama bila tanpa
 * Worker (perilaku lama, hasil piksel identik).
 */
import { applyFrame, type PhotoFrame } from "../../photo-studio/shared/frames";
import {
  createWorkerClient,
  type WorkerClient,
} from "../../shared/createWorkerClient";
import type {
  FrameWorkerRequestNoId,
  FrameWorkerResponse,
} from "./frameWorkerApi";

export interface FrameBatchItem {
  url: string;
  /** Teks Booth khusus foto ini; kosong/undefined = teks default event. */
  boothText?: string;
}

export interface FrameBatchDefaults {
  hashtagText: string;
  bannerText: string;
}

export type FrameWorkerClient = WorkerClient<
  FrameWorkerRequestNoId,
  FrameWorkerResponse
>;

/** Worker dibuat lazy per klien — pool kecil agar batch paralel aman memori. */
export function createFrameWorkerPool(size = 3): FrameWorkerClient[] {
  const n = Math.max(
    1,
    Math.min(
      size,
      typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2
    )
  );
  return Array.from({ length: n }, () =>
    createWorkerClient<FrameWorkerRequestNoId, FrameWorkerResponse>({
      createWorker: () =>
        new Worker(new URL("./frame.worker.ts", import.meta.url), {
          type: "module",
        }),
      errorMessage: "Worker gagal mem-frame foto.",
    })
  );
}

/** Hentikan semua worker pool (tolak permintaan tertunda + terminate). */
export function terminateFrameWorkerPool(clients: FrameWorkerClient[]): void {
  for (const c of clients) c.terminate();
}

async function frameOne(
  client: FrameWorkerClient,
  item: FrameBatchItem,
  frame: PhotoFrame,
  width: number,
  height: number,
  defaults: FrameBatchDefaults
): Promise<string> {
  const hashtagText = item.boothText?.trim()
    ? item.boothText
    : defaults.hashtagText;
  const bannerText = item.boothText?.trim()
    ? item.boothText
    : defaults.bannerText;
  // fetch bekerja untuk blob: maupun data: URL (pola yang sama dengan
  // forwardPhoto); Blob diklone ke worker — decode terjadi di sana.
  const fetched = await fetch(item.url);
  const srcBlob = await fetched.blob();
  const res = await client.post({
    type: "frame",
    frameId: frame.id,
    width,
    height,
    blob: srcBlob,
    hashtagText,
    bannerText,
  });
  if (!res.ok) throw new Error(res.error);
  return res.dataUrl;
}

async function frameSlice(
  client: FrameWorkerClient,
  items: FrameBatchItem[],
  frame: PhotoFrame,
  width: number,
  height: number,
  defaults: FrameBatchDefaults,
  isCancelled: () => boolean
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const item of items) {
    if (isCancelled()) return result;
    try {
      result[item.url] = await frameOne(
        client,
        item,
        frame,
        width,
        height,
        defaults
      );
    } catch {
      // gagal di-frame — biarkan foto asli (semantik sama dengan loop lama)
    }
  }
  return result;
}

/**
 * Frame seluruh batch (URL → data URL ber-bingkai). `isCancelled` dicek per
 * foto — pembatalan mengembalikan peta parsial (pemanggil membuangnya).
 * Foto yang gagal di-frame dibiarkan memakai URL asli.
 */
export async function frameAll(
  clients: FrameWorkerClient[],
  items: FrameBatchItem[],
  frame: PhotoFrame,
  width: number,
  height: number,
  defaults: FrameBatchDefaults,
  isCancelled: () => boolean,
  useWorker: boolean
): Promise<Record<string, string>> {
  if (!useWorker || clients.length === 0) {
    // Fallback thread utama — jalur lama, hasil piksel identik.
    const result: Record<string, string> = {};
    for (const item of items) {
      if (isCancelled()) return result;
      try {
        result[item.url] = await applyFrame(item.url, frame, width, height, {
          hashtagText: item.boothText?.trim()
            ? item.boothText
            : defaults.hashtagText,
          bannerText: item.boothText?.trim()
            ? item.boothText
            : defaults.bannerText,
        });
      } catch {
        // biarkan foto asli
      }
    }
    return result;
  }
  // Pool: bagi batch merata per worker (bagian berurutan di tiap worker,
  // satu blob per permintaan — memori aman).
  const n = Math.min(clients.length, items.length);
  const slices = Array.from({ length: n }, (_, i) =>
    items.filter((_, j) => j % n === i)
  );
  const parts = await Promise.all(
    slices.map((slice, i) =>
      frameSlice(clients[i], slice, frame, width, height, defaults, isCancelled)
    )
  );
  return Object.assign({}, ...parts);
}
