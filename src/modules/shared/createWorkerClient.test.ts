import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerClient } from "./createWorkerClient";

// --- Fake Worker (vitest berjalan di Node tanpa Worker/DOM) ---
// Meniru permukaan Worker yang dipakai createWorkerClient: add/removeEventListener
// (message/error), postMessage(msg, transfer), terminate.

interface PostedMsg {
  msg: Record<string, unknown>;
  transfer?: Transferable[];
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners: Record<string, Array<(e: unknown) => void>> = {
    message: [],
    error: [],
  };
  posted: PostedMsg[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(cb);
  }

  removeEventListener(type: string, cb: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(
      (f) => f !== cb
    );
  }

  postMessage(msg: unknown, transfer?: Transferable[]): void {
    this.posted.push({ msg: msg as Record<string, unknown>, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  // --- helper pengujian ---
  dispatchMessage(data: unknown): void {
    for (const cb of [...this.listeners.message]) cb({ data });
  }

  dispatchError(): void {
    for (const cb of [...this.listeners.error]) cb(new Event("error"));
  }

  listenerCount(type: string): number {
    return (this.listeners[type] ?? []).length;
  }
}

/** Respon worker dengan id (kontrak `Res extends { id: number }`). */
const res = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  ...extra,
});

beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const makeClient = () =>
  createWorkerClient<{ n: number }, { id: number; n: number }>({
    createWorker: () => new Worker("fake", { type: "module" }) as unknown as Worker,
    errorMessage: "Worker gagal memproses.",
  });

describe("createWorkerClient — plumbing async worker", () => {
  it("worker dibuat LAZY: belum ada sampai post pertama", () => {
    const client = makeClient();
    expect(FakeWorker.instances).toHaveLength(0);
    void client.post({ n: 1 });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("id-sequence: tiap post mendapat id bertambah & payload diteruskan", () => {
    const client = makeClient();
    void client.post({ n: 10 });
    void client.post({ n: 20 });
    const w = FakeWorker.instances[0];
    expect(w.posted.map((p) => p.msg.id)).toEqual([1, 2]);
    expect(w.posted[0].msg).toMatchObject({ n: 10 });
    expect(w.posted[1].msg).toMatchObject({ n: 20 });
  });

  it("respons dengan id benar me-resolve; id salah diabaikan", async () => {
    const client = makeClient();
    const p1 = client.post({ n: 1 });
    const p2 = client.post({ n: 2 });
    const w = FakeWorker.instances[0];
    // Balasan datang terbalik urutannya — id 2 dulu, lalu 1.
    w.dispatchMessage(res(2, { n: 22 }));
    // p1 masih menunggu — id 1 belum datang.
    let settled = false;
    void p1.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    w.dispatchMessage(res(1, { n: 11 }));
    await expect(p2).resolves.toEqual({ id: 2, n: 22 });
    await expect(p1).resolves.toEqual({ id: 1, n: 11 });
  });

  it("respons dengan id tak dikenal tidak men-settle permintaan apa pun", async () => {
    const client = makeClient();
    const p = client.post({ n: 1 });
    const w = FakeWorker.instances[0];
    w.dispatchMessage(res(99, { n: 999 }));
    let settled = false;
    void p.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    // Setelah id benar datang, baru resolve.
    w.dispatchMessage(res(1, { n: 1 }));
    await expect(p).resolves.toEqual({ id: 1, n: 1 });
  });

  it("event error worker → reject dengan errorMessage (bukan hang)", async () => {
    const client = makeClient();
    const p = client.post({ n: 1 });
    FakeWorker.instances[0].dispatchError();
    await expect(p).rejects.toThrow("Worker gagal memproses.");
  });

  it("listener per permintaan di-cleanup setelah settle (tidak double-resolve / bocor)", async () => {
    const client = makeClient();
    const p1 = client.post({ n: 1 });
    void client.post({ n: 2 });
    const w = FakeWorker.instances[0];
    expect(w.listenerCount("message")).toBe(2);
    w.dispatchMessage(res(1, { n: 11 }));
    await p1;
    // Permintaan 1 melepas listener-nya; permintaan 2 masih menunggu.
    expect(w.listenerCount("message")).toBe(1);
    // Double-resolve tidak mungkin: kirim ulang id 1 → tidak ada efek.
    let resolves = 0;
    void client.post({ n: 3 }).then(() => resolves++);
    expect(w.listenerCount("message")).toBe(2);
    w.dispatchMessage(res(1, { n: 111 })); // id basi — diabaikan
    w.dispatchMessage(res(2, { n: 22 }));
    w.dispatchMessage(res(3, { n: 33 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(resolves).toBe(1);
  });

  it("terminate menolak SEMUA permintaan tertunda lalu menghentikan worker", async () => {
    const client = makeClient();
    const p1 = client.post({ n: 1 });
    const p2 = client.post({ n: 2 });
    const w = FakeWorker.instances[0];
    // Handler reject dipasang SEBELUM terminate agar penolakan sinkron tertangkap.
    const e1 = expect(p1).rejects.toThrow("Worker dihentikan.");
    const e2 = expect(p2).rejects.toThrow("Worker dihentikan.");
    client.terminate();
    await e1;
    await e2;
    expect(w.terminated).toBe(true);
  });

  it("terminate(err) memakai pesan kustom untuk semua pending", async () => {
    const client = makeClient();
    const p = client.post({ n: 1 });
    client.terminate(new Error("dibersihkan saat unmount"));
    await expect(p).rejects.toThrow("dibersihkan saat unmount");
  });

  it("post setelah terminate membuat worker BARU dan bekerja normal", async () => {
    const client = makeClient();
    // Dibuang dengan handler agar reject dari terminate tidak jadi unhandled.
    void client.post({ n: 1 }).catch(() => {});
    const first = FakeWorker.instances[0];
    client.terminate();
    expect(first.terminated).toBe(true);
    const p = client.post({ n: 2 });
    // Worker baru (instance ke-2), bukan worker lama.
    expect(FakeWorker.instances).toHaveLength(2);
    const second = FakeWorker.instances[1];
    expect(second.terminated).toBe(false);
    // Sequence LANJUT lintas rekreasi worker (id unik global per klien).
    expect(second.posted[0].msg.id).toBe(2);
    second.dispatchMessage(res(2, { n: 22 }));
    await expect(p).resolves.toEqual({ id: 2, n: 22 });
  });

  it("transfer zero-copy diteruskan apa adanya ke postMessage", () => {
    const client = makeClient();
    const buf = new ArrayBuffer(8);
    void client.post({ n: 1 }, [buf]);
    const w = FakeWorker.instances[0];
    expect(w.posted[0].transfer).toEqual([buf]);
  });
});
