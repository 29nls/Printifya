import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPrintHistory,
  loadReprintHtml,
  MAX_HISTORY,
  MAX_HISTORY_BYTES,
  MAX_REPRINT_CHARS,
  MAX_REPRINT_TOTAL_CHARS,
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

/** Payload v2 apa adanya, untuk menyemai storage di tes. */
function payload(
  records: unknown[],
  blobs: Record<string, unknown> = {}
): string {
  return JSON.stringify({ v: 2, d: { records, blobs } });
}

describe("loadPrintHistory", () => {
  it("tanpa data -> kosong, bukan unreadable", () => {
    const load = loadPrintHistory();
    expect(load.records).toEqual([]);
    expect(load.reprintable).toEqual([]);
    expect(load.unreadable).toBe(false);
    expect(load.locked).toBe(false);
    expect(load.dropped).toBe(0);
  });

  it("entri rusak disaring, entri valid tetap ada", () => {
    store.map.set(
      STORE_KEY,
      payload([
        record("Surat Dinas"),
        { name: "", timestamp: 1 }, // nama kosong
        { name: "Tanpa waktu" }, // timestamp 0
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
      payload([
        { name: "Kwitansi", timestamp: 1, copies: "banyak", status: "aneh" },
      ])
    );

    const load = loadPrintHistory();
    expect(load.records[0]).toMatchObject({
      copies: 1,
      paperSize: "A4",
      status: "done",
    });
    expect(load.records[0].htmlKey).toBeUndefined();
  });

  it("payload bukan objek ber-records -> unreadable", () => {
    store.map.set(STORE_KEY, JSON.stringify({ v: 2, d: { records: "bukan" } }));
    expect(loadPrintHistory().unreadable).toBe(true);
  });

  it("versi lebih baru -> locked, tanpa tulis, storage utuh", () => {
    const raw = JSON.stringify({ v: 9, d: { records: [record("Baru")], blobs: {} } });
    store.map.set(STORE_KEY, raw);

    const load = loadPrintHistory();
    expect(load.locked).toBe(true);
    expect(load.records).toEqual([]);
    expect(store.map.get(STORE_KEY)).toBe(raw);
  });
});

describe("migrasi v1 -> v2", () => {
  it("array v1 tanpa envelope dibaca sebagai riwayat, tanpa cetak ulang", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify([record("Surat Lama"), record("Kwitansi Lama")])
    );

    const load = loadPrintHistory();
    expect(load.records.map((r) => r.name)).toEqual([
      "Surat Lama",
      "Kwitansi Lama",
    ]);
    // Versi 1 belum menyimpan hasil cetak, jadi belum ada yang bisa dicetak ulang.
    expect(load.reprintable).toEqual([]);
    expect(load.records.every((r) => r.htmlKey === undefined)).toBe(true);
  });

  it("array v1 ber-envelope juga dimigrasi", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify({ v: 1, d: [record("Surat Lama")] })
    );

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(1);
    expect(load.records[0].name).toBe("Surat Lama");
  });
});

describe("recordPrint — pencatatan", () => {
  it("menulis envelope versi 2 dan mencatat status", () => {
    expect(
      recordPrint({ name: "Surat Dinas", paperSize: "A4", ok: true })
    ).toEqual({ ok: true });

    expect(JSON.parse(store.map.get(STORE_KEY) ?? "null")).toMatchObject({ v: 2 });

    const load = loadPrintHistory();
    expect(load.records[0]).toMatchObject({
      name: "Surat Dinas",
      paperSize: "A4",
      copies: 1,
      status: "done",
    });
    expect(load.records[0].timestamp).toBeGreaterThan(0);
  });

  it("ok=false tercatat sebagai 'failed'", () => {
    recordPrint({ name: "Kwitansi", paperSize: "A5", ok: false });
    expect(loadPrintHistory().records[0].status).toBe("failed");
  });

  it("riwayat terbaru di depan", () => {
    recordPrint({ name: "Pertama", paperSize: "A4", ok: true });
    recordPrint({ name: "Kedua", paperSize: "A4", ok: true });
    expect(loadPrintHistory().records.map((r) => r.name)).toEqual([
      "Kedua",
      "Pertama",
    ]);
  });

  it("nama kosong dan copies tak valid dinormalkan", () => {
    recordPrint({ name: "   ", paperSize: "", ok: true, copies: 0 });
    expect(loadPrintHistory().records[0]).toMatchObject({
      name: "Tanpa nama",
      paperSize: "A4",
      copies: 1,
    });
  });

  it("storage penuh -> {ok:false,'quota'} tanpa melempar", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
      removeItem: () => undefined,
    });

    expect(() =>
      recordPrint({ name: "Surat", paperSize: "A4", ok: true })
    ).not.toThrow();
    expect(recordPrint({ name: "Surat", paperSize: "A4", ok: true })).toEqual({
      ok: false,
      reason: "quota",
    });
  });

  it("data versi lebih baru -> tidak menimpa, hasil 'unavailable'", () => {
    const raw = JSON.stringify({ v: 9, d: { records: [record("Baru")], blobs: {} } });
    store.map.set(STORE_KEY, raw);

    expect(
      recordPrint({ name: "Cetakan Lama", paperSize: "A4", ok: true })
    ).toEqual({ ok: false, reason: "unavailable" });
    expect(store.map.get(STORE_KEY)).toBe(raw);
  });
});

describe("recordPrint — cetak ulang", () => {
  it("HTML tersimpan dan bisa diambil kembali untuk entri itu", () => {
    const html = "<html>surat</html>";
    recordPrint({ name: "Surat", paperSize: "A4", ok: true, html });

    const load = loadPrintHistory();
    expect(load.reprintable).toEqual([load.records[0].id]);
    expect(loadReprintHtml(load.records[0])).toBe(html);
  });

  it("tanpa HTML, entri tetap tercatat tetapi tidak bisa dicetak ulang", () => {
    recordPrint({ name: "Pas Foto 3x4", paperSize: "A4", ok: true });

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(1);
    expect(load.reprintable).toEqual([]);
    expect(loadReprintHtml(load.records[0])).toBeNull();
  });

  it("HTML melebihi MAX_REPRINT_CHARS tidak disimpan, entri tetap ada", () => {
    const html = "x".repeat(MAX_REPRINT_CHARS + 1);
    recordPrint({ name: "Auto Layout (8 foto)", paperSize: "A4", ok: true, html });

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(1);
    expect(load.records[0].htmlKey).toBeUndefined();
    expect(load.reprintable).toEqual([]);
    expect(loadReprintHtml(load.records[0])).toBeNull();
  });

  it("HTML identik dipakai bersama, bukan digandakan", () => {
    const html = "<html>surat sama</html>";
    recordPrint({ name: "Surat", paperSize: "A4", ok: true, html });
    recordPrint({ name: "Surat", paperSize: "A4", ok: true, html });

    const stored = JSON.parse(store.map.get(STORE_KEY) ?? "null");
    expect(stored.d.records).toHaveLength(2);
    expect(Object.keys(stored.d.blobs)).toHaveLength(1);
    // Kedua entri menunjuk blob yang sama.
    expect(stored.d.records[0].htmlKey).toBe(stored.d.records[1].htmlKey);

    const load = loadPrintHistory();
    expect(load.reprintable).toHaveLength(2);
    expect(loadReprintHtml(load.records[1])).toBe(html);
  });

  it("HTML berbeda memakai blob berbeda", () => {
    recordPrint({ name: "A", paperSize: "A4", ok: true, html: "<html>a</html>" });
    recordPrint({ name: "B", paperSize: "A4", ok: true, html: "<html>b</html>" });

    const stored = JSON.parse(store.map.get(STORE_KEY) ?? "null");
    expect(Object.keys(stored.d.blobs)).toHaveLength(2);
  });

  it("anggaran total: dokumen terbaru yang bertahan", () => {
    const big = (ch: string) => ch.repeat(150_000);
    recordPrint({ name: "Tertua", paperSize: "A4", ok: true, html: big("c") });
    recordPrint({ name: "Tengah", paperSize: "A4", ok: true, html: big("b") });
    recordPrint({ name: "Terbaru", paperSize: "A4", ok: true, html: big("a") });

    const load = loadPrintHistory();
    // Ketiganya tercatat, tetapi hanya dua dokumen terbaru yang isinya muat.
    expect(load.records.map((r) => r.name)).toEqual([
      "Terbaru",
      "Tengah",
      "Tertua",
    ]);
    expect(load.reprintable).toHaveLength(2);
    expect(loadRecipients(load)).toEqual(["Terbaru", "Tengah"]);

    const stored = JSON.parse(store.map.get(STORE_KEY) ?? "null");
    const totalChars: number = Object.values(stored.d.blobs).reduce(
      (n: number, v) => n + String(v).length,
      0
    );
    expect(totalChars).toBeLessThanOrEqual(MAX_REPRINT_TOTAL_CHARS);

    // Dokumen tertua kehilangan isinya, jadi tidak bisa dicetak ulang.
    const oldest = load.records[2];
    expect(loadReprintHtml(oldest)).toBeNull();
  });

  it("menghapus riwayat juga membuang HTML tersimpan", () => {
    recordPrint({ name: "Surat", paperSize: "A4", ok: true, html: "<html>x</html>" });
    expect(savePrintHistory([])).toEqual({ ok: true });

    const stored = JSON.parse(store.map.get(STORE_KEY) ?? "null");
    expect(stored.d.records).toEqual([]);
    expect(stored.d.blobs).toEqual({});
  });
});

/** Nama entri yang masih bisa dicetak ulang, untuk asersi yang mudah dibaca. */
function loadRecipients(load: ReturnType<typeof loadPrintHistory>): string[] {
  const ids = new Set(load.reprintable);
  return load.records.filter((r) => ids.has(r.id)).map((r) => r.name);
}

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

  it("recordPrint menyusut saat riwayat penuh, blob lama ikut dibuang", () => {
    const full = Array.from({ length: MAX_HISTORY }, (_, i) =>
      record(`lama-${i}`)
    );
    expect(savePrintHistory(full)).toEqual({ ok: true });

    recordPrint({
      name: "Terbaru",
      paperSize: "A4",
      ok: true,
      html: "<html>baru</html>",
    });

    const load = loadPrintHistory();
    expect(load.records).toHaveLength(MAX_HISTORY);
    expect(load.records[0].name).toBe("Terbaru");
    expect(load.records.some((r) => r.name === `lama-${MAX_HISTORY - 1}`)).toBe(
      false
    );
  });
});
