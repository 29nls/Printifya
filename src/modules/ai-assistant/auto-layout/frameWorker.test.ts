import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhotoFrame } from "../../photo-studio/shared/frames";
import type { FrameWorkerResponse } from "./frameWorkerApi";
import {
  createFrameWorkerPool,
  frameAll,
  splitBatch,
  type FrameWorkerClient,
} from "./frameWorker";

// Jalur worker diuji dengan KLIEN PALSU (interface WorkerClient) + fetch di-stub
// — tidak ada Worker/fetch nyata di env node vitest (pola createWorkerClient.test).
// Jalur fallback thread utama diuji dengan applyFrame di-mock (vi.mock frames).

vi.mock("../../photo-studio/shared/frames", () => ({
  applyFrame: vi.fn(async (url: string) => `data:image/png;base64,${url}`),
}));

const frame = { id: "booth-hashtag" } as unknown as PhotoFrame;

/** Klien palsu: post selalu berhasil dengan data URL tetap. */
const makeClient = (): FrameWorkerClient => ({
  post: vi.fn(async (): Promise<FrameWorkerResponse> => ({
    type: "frame",
    id: 0,
    ok: true,
    dataUrl: "data:image/png;base64,WUVTIElNQUdF",
  })),
  terminate: vi.fn(),
});

const makeItems = (n: number, prefix = "blob:photo") =>
  Array.from({ length: n }, (_, i) => ({
    url: `${prefix}-${i}`,
    boothText: i % 2 === 0 ? `Teks ${i}` : undefined,
  }));

const postCount = (c: FrameWorkerClient): number =>
  vi.mocked(c.post).mock.calls.length;

const defaults = { hashtagText: "#SENYUM", bannerText: "PHOTO BOOTH" };

beforeEach(() => {
  // Mock applyFrame (vi.mock frames) dan fetch dipakai lintas test — bersihkan
  // data panggilan agar hitungan per-test akurat.
  vi.clearAllMocks();
  // frameOne memanggil fetch(item.url) lalu .blob() di thread utama — di-stub
  // agar tidak ada jaringan; Blob sah di node.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ blob: async () => new Blob(["x"]) }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("splitBatch — slicing batch merata (round-robin)", () => {
  it("30 foto / 3 worker → 3 bucket × 10, urutan per bucket dipertahankan", () => {
    const items = makeItems(30);
    const s = splitBatch(items, 3);
    expect(s.map((x) => x.length)).toEqual([10, 10, 10]);
    expect(s[0].map((i) => i.url)).toEqual(
      items.filter((_, j) => j % 3 === 0).map((i) => i.url)
    );
    // Union = semua foto, tanpa duplikasi.
    expect(new Set(s.flat().map((i) => i.url)).size).toBe(30);
  });

  it("5 foto / 2 worker → 3 + 2", () => {
    const s = splitBatch(makeItems(5), 2);
    expect(s.map((x) => x.length)).toEqual([3, 2]);
  });

  it("3 foto / 4 worker → 3 bucket × 1 (k = min)", () => {
    const s = splitBatch(makeItems(3), 4);
    expect(s.map((x) => x.length)).toEqual([1, 1, 1]);
  });

  it("batch kosong → []", () => {
    expect(splitBatch([], 3)).toEqual([]);
  });

  it("distribusi merata: selisih bucket maksimal 1 untuk ukuran bervariasi", () => {
    for (const total of [7, 10, 29]) {
      for (const n of [1, 2, 3, 5]) {
        const lens = splitBatch(makeItems(total), n).map((x) => x.length);
        if (lens.length > 0) {
          expect(Math.max(...lens) - Math.min(...lens)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe("frameAll — jalur worker (klien palsu + fetch stub)", () => {
  it("mendistribusikan batch merata: jumlah post per klien = ukuran slice", async () => {
    const clients = [makeClient(), makeClient(), makeClient()];
    const res = await frameAll(
      clients,
      makeItems(30),
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    expect(clients.map(postCount)).toEqual([10, 10, 10]);
    expect(Object.keys(res).length).toBe(30);
  });

  it("pool lebih besar dari jumlah foto: klien ekstra tidak dipakai", async () => {
    const clients = [makeClient(), makeClient(), makeClient(), makeClient()];
    const res = await frameAll(
      clients,
      makeItems(3),
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    expect(clients.map(postCount)).toEqual([1, 1, 1, 0]);
    expect(Object.keys(res).length).toBe(3);
  });

  it("agregasi hasil: semua URL foto jadi kunci, nilai = dataUrl worker", async () => {
    const clients = [makeClient(), makeClient()];
    const items = makeItems(5);
    const res = await frameAll(
      clients,
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    expect(Object.keys(res).sort()).toEqual(items.map((i) => i.url).sort());
    for (const v of Object.values(res)) {
      expect(v).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("pesan worker memuat frameId, dimensi, Blob sumber & teks default", async () => {
    const client = makeClient();
    // Tanpa boothText per foto — teks default event yang harus terkirim.
    const items = [{ url: "blob:a" }, { url: "blob:b" }];
    await frameAll(
      [client],
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    const posts = vi.mocked(client.post).mock.calls.map((c) => c[0]);
    expect(posts[0]).toMatchObject({
      type: "frame",
      frameId: "booth-hashtag",
      width: 354,
      height: 472,
      hashtagText: "#SENYUM",
      bannerText: "PHOTO BOOTH",
    });
    expect(posts[0].blob).toBeInstanceOf(Blob);
  });

  it("teks Booth per foto menimpa default event", async () => {
    const client = makeClient();
    const items = [
      { url: "blob:p0", boothText: "Nama Tamu" },
      { url: "blob:p1" },
    ];
    await frameAll(
      [client],
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    const posts = vi.mocked(client.post).mock.calls.map((c) => c[0]);
    expect(posts[0].hashtagText).toBe("Nama Tamu");
    expect(posts[0].bannerText).toBe("Nama Tamu");
    expect(posts[1].hashtagText).toBe("#SENYUM");
    expect(posts[1].bannerText).toBe("PHOTO BOOTH");
  });

  it("pembatalan PER FOTO: isCancelled menghentikan sisa batch (pool 1, serial)", async () => {
    const client = makeClient();
    let calls = 0;
    const res = await frameAll(
      [client],
      makeItems(10),
      frame,
      354,
      472,
      defaults,
      () => ++calls > 3,
      true
    );
    // Tepat 3 foto diproses — sisanya tidak pernah di-post.
    expect(postCount(client)).toBe(3);
    expect(Object.keys(res).length).toBe(3);
  });

  it("pembatalan di tengah batch multi-worker: semua slice berhenti", async () => {
    const clients = [makeClient(), makeClient(), makeClient()];
    let calls = 0;
    const res = await frameAll(
      clients,
      makeItems(30),
      frame,
      354,
      472,
      defaults,
      () => ++calls > 5,
      true
    );
    const total = clients.reduce((a, c) => a + postCount(c), 0);
    expect(total).toBe(5);
    expect(Object.keys(res).length).toBe(5);
  });

  it("isCancelled true sejak awal → tidak ada post, hasil kosong", async () => {
    const client = makeClient();
    const res = await frameAll(
      [client],
      makeItems(5),
      frame,
      354,
      472,
      defaults,
      () => true,
      true
    );
    expect(postCount(client)).toBe(0);
    expect(res).toEqual({});
  });

  it("foto yang gagal di worker dilewati (hasil parsial tanpa error)", async () => {
    const okClient: FrameWorkerClient = {
      post: vi.fn(async (): Promise<FrameWorkerResponse> => ({
        type: "frame",
        id: 0,
        ok: true,
        dataUrl: "data:image/png;base64,QUJD",
      })),
      terminate: vi.fn(),
    };
    const failClient: FrameWorkerClient = {
      post: vi.fn(async (): Promise<FrameWorkerResponse> => ({
        type: "frame",
        id: 0,
        ok: false,
        error: "gagal",
      })),
      terminate: vi.fn(),
    };
    // 3 foto, 2 klien → slice 0 = {0, 2} (ok), slice 1 = {1} (gagal).
    const res = await frameAll(
      [okClient, failClient],
      makeItems(3),
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    expect(Object.keys(res).sort()).toEqual(["blob:photo-0", "blob:photo-2"]);
    expect(res["blob:photo-1"]).toBeUndefined();
  });
});

describe("frameAll — fallback thread utama (applyFrame di-mock)", () => {
  it("useWorker=false: semua foto via applyFrame dengan teks yang benar", async () => {
    const { applyFrame } = await import("../../photo-studio/shared/frames");
    const items = [
      { url: "blob:f0", boothText: "Kustom" },
      { url: "blob:f1" },
    ];
    const res = await frameAll(
      [],
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      false
    );
    expect(Object.keys(res).sort()).toEqual(["blob:f0", "blob:f1"]);
    expect(vi.mocked(applyFrame)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(applyFrame)).toHaveBeenCalledWith("blob:f0", frame, 354, 472, {
      hashtagText: "Kustom",
      bannerText: "Kustom",
    });
    expect(vi.mocked(applyFrame)).toHaveBeenCalledWith("blob:f1", frame, 354, 472, {
      hashtagText: "#SENYUM",
      bannerText: "PHOTO BOOTH",
    });
    expect(res["blob:f0"]).toBe("data:image/png;base64,blob:f0");
  });

  it("useWorker=true tapi klien kosong → jatuh ke fallback (guard)", async () => {
    const { applyFrame } = await import("../../photo-studio/shared/frames");
    const res = await frameAll(
      [],
      makeItems(2),
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    expect(vi.mocked(applyFrame)).toHaveBeenCalledTimes(2);
    expect(Object.keys(res).length).toBe(2);
  });

  it("pembatalan juga berlaku di fallback (per foto)", async () => {
    const { applyFrame } = await import("../../photo-studio/shared/frames");
    let calls = 0;
    const res = await frameAll(
      [],
      makeItems(5),
      frame,
      354,
      472,
      defaults,
      () => ++calls > 2,
      false
    );
    expect(vi.mocked(applyFrame).mock.calls.length).toBe(2);
    expect(Object.keys(res).length).toBe(2);
  });

  it("foto yang gagal di applyFrame dilewati", async () => {
    const { applyFrame } = await import("../../photo-studio/shared/frames");
    vi.mocked(applyFrame).mockRejectedValueOnce(new Error("korup"));
    const res = await frameAll(
      [],
      makeItems(2),
      frame,
      354,
      472,
      defaults,
      () => false,
      false
    );
    expect(Object.keys(res).length).toBe(1);
  });
});

describe("frameAll — konsistensi worker vs fallback", () => {
  it("kunci hasil identik: semua foto tercakup di kedua jalur", async () => {
    const clients = [makeClient(), makeClient()];
    const items = makeItems(6);
    const workerRes = await frameAll(
      clients,
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      true
    );
    const fallbackRes = await frameAll(
      [],
      items,
      frame,
      354,
      472,
      defaults,
      () => false,
      false
    );
    expect(Object.keys(workerRes).sort()).toEqual(
      Object.keys(fallbackRes).sort()
    );
    expect(Object.keys(workerRes).sort()).toEqual(
      items.map((i) => i.url).sort()
    );
  });
});

describe("createFrameWorkerPool — ukuran pool di-clamp", () => {
  it("dibatasi hardwareConcurrency; tidak membuat Worker sebelum post (lazy)", async () => {
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    // Worker palsu yang melempar bila dikonstruksi — pool creation tidak boleh
    // menyentuhnya (lazy sampai post pertama, diuji di createWorkerClient.test).
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("Worker tidak boleh dibuat sebelum post");
        }
      }
    );
    expect(createFrameWorkerPool(6)).toHaveLength(4);
    expect(createFrameWorkerPool(1)).toHaveLength(1);
    expect(createFrameWorkerPool(0)).toHaveLength(1);
    expect(createFrameWorkerPool(3)).toHaveLength(3);
  });
});
