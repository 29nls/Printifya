import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPrintHistory,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  pruneHistory,
  recordPrint,
  savePrintHistory,
  type PrintRecord,
} from "./printHistoryStorage";

const STORE_KEY = "printifya.printHistory";

/** localStorage palsu — vitest berjalan di Node tanpa DOM (lihat downloadUrl.test.ts). */
function createStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

let store: ReturnType<typeof createStorage>;

beforeEach(() => {
  store = createStorage();
  vi.stubGlobal("localStorage", store);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(name: string, overrides: Partial<PrintRecord> = {}): PrintRecord {
  return {
    id: `id-${name}`,
    name,
    copies: 1,
    paperSize: "A4",
    timestamp: 1_700_000_000_000,
    status: "done",
    ...overrides,
  };
}

describe("loadPrintHistory", () => {
  it("tanpa data -> kosong, bukan unreadable", () => {
    const load = loadPrintHistory();
    expect(load.records).toEqual([]);
    expect(load.unreadable).toBe(false);
    expect(load.locked).toBe(false);
    expect(load.dropped).toBe(0);
  });

  it("data lama (v1 tanpa envelope) dibaca, entri rusak disaring", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify([
        record("Surat Dinas"),
        { name: "", timestamp: 1 }, // nama kosong -> dibuang
        { name: "Tanpa waktu" }, // timestamp 0 -> dibuang
        "bukan entri",
      ])
    );

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(1);
    expect(load.records[0].name).toBe("Surat Dinas");
    expect(load.dropped).toBe(3);
  });

  it("field salah tipe jatuh ke default, entri tidak hilang", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify([
        { name: "Kwitansi", timestamp: 1, copies: "banyak", status: "aneh" },
      ])
    );

    const load = loadPrintHistory();
    expect(load.records[0]).toMatchObject({
      copies: 1,
      paperSize: "A4",
      status: "done",
    });
  });

  it("status 'failed' dipertahankan", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify([record("Gagal", { status: "failed" })])
    );
    expect(loadPrintHistory().records[0].status).toBe("failed");
  });

  it("data bukan array -> unreadable", () => {
    store.map.set(STORE_KEY, JSON.stringify({ v: 1, d: "bukan array" }));
    expect(loadPrintHistory().unreadable).toBe(true);
  });

  it("versi lebih baru -> locked, tanpa tulis, storage utuh", () => {
    const raw = JSON.stringify({ v: 9, d: [record("Baru")] });
    store.map.set(STORE_KEY, raw);

    const load = loadPrintHistory();
    expect(load.locked).toBe(true);
    expect(load.records).toEqual([]);
    expect(store.map.get(STORE_KEY)).toBe(raw);
  });
});

describe("recordPrint", () => {
  it("mencatat cetak berhasil dan menulis envelope versi 1", () => {
    expect(recordPrint("Surat Dinas", "A4", true)).toEqual({ ok: true });

    expect(JSON.parse(store.map.get(STORE_KEY) ?? "null")).toMatchObject({ v: 1 });

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(1);
    expect(load.records[0]).toMatchObject({
      name: "Surat Dinas",
      paperSize: "A4",
      copies: 1,
      status: "done",
    });
    expect(load.records[0].timestamp).toBeGreaterThan(0);
  });

  it("ok=false tercatat sebagai status 'failed'", () => {
    recordPrint("Kwitansi", "A5", false);
    expect(loadPrintHistory().records[0].status).toBe("failed");
  });

  it("riwayat terbaru di depan", () => {
    recordPrint("Pertama", "A4", true);
    recordPrint("Kedua", "A4", true);
    expect(loadPrintHistory().records.map((r) => r.name)).toEqual([
      "Kedua",
      "Pertama",
    ]);
  });

  it("nama kosong / copies tak valid dinormalkan", () => {
    recordPrint("   ", "", true, 0);
    expect(loadPrintHistory().records[0]).toMatchObject({
      name: "Tanpa nama",
      paperSize: "A4",
      copies: 1,
    });
  });

  it("menghormati copies yang diberikan", () => {
    recordPrint("Borongan", "A4", true, 3);
    expect(loadPrintHistory().records[0].copies).toBe(3);
  });

  it("storage penuh -> {ok:false,'quota'} tanpa melempar", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
      removeItem: () => undefined,
    });

    expect(() => recordPrint("Surat", "A4", true)).not.toThrow();
    expect(recordPrint("Surat", "A4", true)).toEqual({
      ok: false,
      reason: "quota",
    });
  });

  it("data versi lebih baru -> tidak menimpa, hasil 'unavailable'", () => {
    const raw = JSON.stringify({ v: 9, d: [record("Baru")] });
    store.map.set(STORE_KEY, raw);

    expect(recordPrint("Cetakan Lama", "A4", true)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(store.map.get(STORE_KEY)).toBe(raw);
  });
});

describe("pruneHistory — anggaran jumlah dan byte", () => {
  it("membatasi ke MAX_HISTORY entri, terbaru dipertahankan", () => {
    const records = Array.from({ length: MAX_HISTORY + 5 }, (_, i) =>
      record(`r${i}`)
    );

    const kept = pruneHistory(records);
    expect(kept).toHaveLength(MAX_HISTORY);
    expect(kept[0].name).toBe("r0");
    expect(kept[kept.length - 1].name).toBe(`r${MAX_HISTORY - 1}`);
  });

  it("melewati entri raksasa tanpa membuang entri di belakangnya", () => {
    const huge = record("x".repeat(MAX_HISTORY_BYTES + 10));
    const kept = pruneHistory([huge, record("a"), record("b"), record("c")]);
    expect(kept.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  it("recordPrint tetap menyusut saat riwayat sudah penuh", () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) => record(`lama-${i}`));
    expect(savePrintHistory(full)).toEqual({ ok: true });

    recordPrint("Terbaru", "A4", true);

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(MAX_HISTORY);
    expect(load.records[0].name).toBe("Terbaru");
    // Entri paling lama terdorong keluar.
    expect(load.records.some((r) => r.name === `lama-${MAX_HISTORY - 1}`)).toBe(
      false
    );
  });
});
