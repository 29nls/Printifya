import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPrinters,
  savePrinters,
  validatePrinter,
  type Printer,
} from "./printerStorage";

const STORE_KEY = "printifya.network-printers";

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

const GOOD: Printer = {
  id: "p1",
  name: "Printer Kantor",
  host: "192.168.1.50",
  port: 631,
  path: "/ipp/print",
};

describe("validatePrinter", () => {
  it("entri valid dipertahankan apa adanya", () => {
    expect(validatePrinter(GOOD)).toEqual(GOOD);
  });

  it("host/port tak valid ditolak", () => {
    expect(validatePrinter({ ...GOOD, host: "" })).toBeNull();
    expect(validatePrinter({ ...GOOD, host: "   " })).toBeNull();
    expect(validatePrinter({ ...GOOD, port: 0 })).toBeNull();
    expect(validatePrinter({ ...GOOD, port: -1 })).toBeNull();
    expect(validatePrinter({ ...GOOD, port: 65536 })).toBeNull();
  });

  it("batas port yang sah diterima", () => {
    expect(validatePrinter({ ...GOOD, port: 1 })?.port).toBe(1);
    expect(validatePrinter({ ...GOOD, port: 65535 })?.port).toBe(65535);
  });

  it("bukan objek ditolak", () => {
    expect(validatePrinter(null)).toBeNull();
    expect(validatePrinter("host")).toBeNull();
    expect(validatePrinter([GOOD])).toBeNull();
  });

  it("field hilang/tak bertipe benar jatuh ke default", () => {
    const result = validatePrinter({ host: "10.0.0.5", port: "631" });
    expect(result).toEqual({
      id: "legacy-10.0.0.5:631",
      name: "10.0.0.5",
      host: "10.0.0.5",
      port: 631,
      path: "/ipp/print",
    });
  });

  it("host di-trim dan port dibulatkan", () => {
    const result = validatePrinter({ ...GOOD, host: "  10.0.0.9  ", port: 631.9 });
    expect(result?.host).toBe("10.0.0.9");
    expect(result?.port).toBe(631);
  });
});

describe("loadPrinters", () => {
  it("tanpa data -> daftar kosong, bukan unreadable", () => {
    const load = loadPrinters();
    expect(load.printers).toEqual([]);
    expect(load.unreadable).toBe(false);
    expect(load.locked).toBe(false);
    expect(load.dropped).toBe(0);
  });

  it("data lama (v1 tanpa envelope) dibaca dan entri rusak disaring", () => {
    store.map.set(
      STORE_KEY,
      JSON.stringify([GOOD, { ...GOOD, id: "p2", host: "", port: 631 }, "bukan entri"])
    );

    const load = loadPrinters();
    expect(load.printers).toEqual([GOOD]);
    expect(load.dropped).toBe(2);
    expect(load.locked).toBe(false);
  });

  it("data bukan array -> unreadable", () => {
    store.map.set(STORE_KEY, JSON.stringify({ v: 1, d: "bukan array" }));
    expect(loadPrinters().unreadable).toBe(true);
  });

  it("versi lebih baru -> locked, tanpa tulis, storage utuh", () => {
    const raw = JSON.stringify({ v: 9, d: [GOOD] });
    store.map.set(STORE_KEY, raw);

    const load = loadPrinters();
    expect(load.locked).toBe(true);
    expect(load.printers).toEqual([]);
    expect(store.map.get(STORE_KEY)).toBe(raw);
  });
});

describe("savePrinters", () => {
  it("menulis envelope versi 1 dan bisa dibaca kembali", () => {
    expect(savePrinters([GOOD])).toEqual({ ok: true });
    expect(JSON.parse(store.map.get(STORE_KEY) ?? "null")).toMatchObject({
      v: 1,
    });

    const load = loadPrinters();
    expect(load.printers).toEqual([GOOD]);
    expect(load.dropped).toBe(0);
  });

  it("storage penuh -> {ok:false, reason:'quota'} tanpa melempar", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
      removeItem: () => undefined,
    });

    expect(() => savePrinters([GOOD])).not.toThrow();
    expect(savePrinters([GOOD])).toEqual({ ok: false, reason: "quota" });
  });
});
