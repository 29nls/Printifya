/**
 * Klien Web Worker generik — pola satu-worker + id-sequence yang sebelumnya
 * disalin verbatim di Upscale & Denoise (`postWorker`), Video Face Enhance
 * (`postFaceWorker`), dan Face Enhance (`postFaceEnhanceWorker`).
 *
 * Plumbing yang ditangani:
 * - worker dibuat malas (lazy) sekali lewat `createWorker` (pada `post`
 *   pertama);
 * - tiap pekerjaan dikirim dengan `id` bertambah (sequence), balasan dicocokkan
 *   per-id lewat listener `message`/`error` yang dibersihkan setelah settle;
 * - penolak permintaan tertunda dicatat agar `terminate` bisa menyelesaikan
 *   semuanya sekaligus (setelah worker di-terminate tidak ada event lagi, jadi
 *   ini satu-satunya cara antrean tidak menggantung);
 * - `terminate(err?)` menolak permintaan tertunda (`err` atau
 *   "Worker dihentikan.") lalu menghentikan worker — urutan yang sama dengan
 *   semua pemanggil (reject-dulu, terminate-kemudian).
 *
 * Payload request/response TIDAK disatukan: `ReqNoId`/`Res` generik per
 * pemanggil (typed), dan `transfer` diteruskan apa adanya (zero-copy
 * ArrayBuffer/ImageBitmap). File worker (.worker.ts) dan jalur fallback
 * thread utama tidak tersentuh.
 */
export interface WorkerClient<ReqNoId, Res extends { id: number }> {
  /** Kirim satu pekerjaan; resolve saat balasan dengan id cocok tiba.
   *  `transfer` diteruskan ke postMessage (zero-copy). */
  post(msg: ReqNoId, transfer?: Transferable[]): Promise<Res>;
  /** Tolak permintaan tertunda (`err` atau "Worker dihentikan.") lalu hentikan
   *  worker dan lupakan referensinya — post berikutnya membuat worker baru. */
  terminate(err?: Error): void;
}

export function createWorkerClient<ReqNoId, Res extends { id: number }>(options: {
  createWorker: () => Worker;
  /** Pesan error saat worker mengirim event `error` (gagal muat/exception). */
  errorMessage?: string;
}): WorkerClient<ReqNoId, Res> {
  let worker: Worker | null = null;
  let seq = 0;
  const pending = new Set<(e: Error) => void>();

  const getWorker = (): Worker => {
    if (!worker) worker = options.createWorker();
    return worker;
  };

  return {
    post(msg, transfer = []) {
      const w = getWorker();
      const id = ++seq;
      return new Promise<Res>((resolve, reject) => {
        const cleanup = () => {
          w.removeEventListener("message", onMessage);
          w.removeEventListener("error", onError);
          pending.delete(reject);
        };
        const onMessage = (e: MessageEvent<Res>) => {
          if (e.data.id !== id) return;
          cleanup();
          resolve(e.data);
        };
        const onError = () => {
          cleanup();
          reject(new Error(options.errorMessage ?? "Worker gagal memproses."));
        };
        pending.add(reject);
        w.addEventListener("message", onMessage);
        w.addEventListener("error", onError);
        w.postMessage({ ...(msg as object), id }, transfer);
      });
    },
    terminate(err = new Error("Worker dihentikan.")) {
      pending.forEach((reject) => reject(err));
      pending.clear();
      worker?.terminate();
      worker = null;
    },
  };
}
