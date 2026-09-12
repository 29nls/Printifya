import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickBoolean,
  pickNullableString,
  pickNumber,
  pickString,
  readVersioned,
  writeVersioned,
  type Migration,
  type VersionedSpec,
} from "./versionedStore";

const KEY = "printifya.test";

/** localStorage palsu — vitest berjalan di Node tanpa DOM (lihat downloadUrl.test.ts). */
function createStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
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

/** Spec identitas: payload string. */
function stringSpec(
  version = 1,
  migrations: Migration[] = []
): VersionedSpec<string> {
  return {
    key: KEY,
    version,
    migrations,
    validate: (v) => (typeof v === "string" ? v : null),
  };
}

describe("readVersioned — pembacaan dan deteksi envelope", () => {
  it("storage kosong -> empty", () => {
    expect(readVersioned(stringSpec())).toEqual({
      status: "empty",
      value: null,
    });
  });

  it("data lama tanpa envelope diperlakukan sebagai v1", () => {
    store.map.set(KEY, JSON.stringify("halo"));
    expect(readVersioned(stringSpec())).toEqual({
      status: "current",
      value: "halo",
    });
  });

  it("envelope dibaca dari field v dan d", () => {
    store.map.set(KEY, JSON.stringify({ v: 1, d: "halo" }));
    expect(readVersioned(stringSpec())).toEqual({
      status: "current",
      value: "halo",
    });
  });

  it("objek lama tanpa field v tidak salah dikenali sebagai envelope", () => {
    // Kasus nyata: LetterFields adalah objek lama yang tidak punya field `v`.
    store.map.set(KEY, JSON.stringify({ instansi: "Dinas", logo: null }));
    const spec: VersionedSpec<{ instansi: string }> = {
      key: KEY,
      version: 2,
      migrations: [
        (input) => ({
          ...(input as Record<string, unknown>),
          instansi: "Dinas Baru",
        }),
      ],
      validate: (v) =>
        typeof v === "object" && v !== null
          ? (v as { instansi: string })
          : null,
    };
    const r = readVersioned(spec);
    expect(r.status).toBe("migrated");
    expect(r.value).toEqual({ instansi: "Dinas Baru", logo: null });
  });

  it("array lama tidak salah dikenali sebagai envelope", () => {
    // Kasus nyata: riwayat surat & daftar printer adalah array lama.
    store.map.set(KEY, JSON.stringify([{ a: 1 }]));
    const spec: VersionedSpec<unknown[]> = {
      key: KEY,
      version: 1,
      migrations: [],
      validate: (v) => (Array.isArray(v) ? v : null),
    };
    expect(readVersioned(spec)).toEqual({
      status: "current",
      value: [{ a: 1 }],
    });
  });
});

describe("readVersioned — rantai migrasi", () => {
  it("rantai dua langkah dijalankan berurutan (v1 -> v3)", () => {
    const seen: string[] = [];
    const spec: VersionedSpec<string> = {
      key: KEY,
      version: 3,
      migrations: [
        (input) => {
          seen.push(`m1:${String(input)}`);
          return `${String(input)}-a`;
        },
        (input) => {
          seen.push(`m2:${String(input)}`);
          return `${String(input)}-b`;
        },
      ],
      validate: (v) => (typeof v === "string" ? v : null),
    };
    store.map.set(KEY, JSON.stringify("x"));

    const r = readVersioned(spec);
    expect(seen).toEqual(["m1:x", "m2:x-a"]);
    expect(r).toEqual({
      status: "migrated",
      value: "x-a-b",
      from: 1,
      previous: "x",
    });
  });

  it("data di versi saat ini tidak menjalankan migrasi", () => {
    const m = vi.fn((v: unknown) => v);
    store.map.set(KEY, JSON.stringify({ v: 2, d: "halo" }));

    const r = readVersioned(stringSpec(2, [m]));

    expect(m).not.toHaveBeenCalled();
    expect(r).toEqual({ status: "current", value: "halo" });
  });

  it("migrasi yang tidak terdaftar -> migration-failed", () => {
    store.map.set(KEY, JSON.stringify("halo"));
    expect(readVersioned(stringSpec(2, []))).toEqual({
      status: "invalid",
      value: null,
      reason: "migration-failed",
    });
  });

  it("migrasi yang melempar ditangkap; storage tidak berubah", () => {
    const before = JSON.stringify("halo");
    store.map.set(KEY, before);

    const r = readVersioned(
      stringSpec(2, [
        () => {
          throw new Error("boom");
        },
      ])
    );

    expect(r).toEqual({
      status: "invalid",
      value: null,
      reason: "migration-failed",
    });
    expect(store.map.get(KEY)).toBe(before);
  });

  it("validator menolak hasil -> validation-failed", () => {
    store.map.set(KEY, JSON.stringify({ v: 1, d: 42 }));
    expect(readVersioned(stringSpec())).toEqual({
      status: "invalid",
      value: null,
      reason: "validation-failed",
    });
  });
});

describe("readVersioned — data dari versi aplikasi yang lebih baru", () => {
  it("-> future, tanpa migrasi, tanpa tulis, storage utuh", () => {
    const m = vi.fn((v: unknown) => v);
    const before = JSON.stringify({ v: 5, d: "baru" });
    store.map.set(KEY, before);

    const r = readVersioned(stringSpec(2, [m]));

    expect(r).toEqual({ status: "future", value: null, found: 5 });
    expect(m).not.toHaveBeenCalled();
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.map.get(KEY)).toBe(before);
  });
});

describe("writeVersioned", () => {
  it("tulis berhasil menyimpan envelope {v,d}", () => {
    expect(writeVersioned(stringSpec(), "halo")).toEqual({ ok: true });
    expect(store.map.get(KEY)).toBe(JSON.stringify({ v: 1, d: "halo" }));
  });

  it("bolak-balik tulis lalu baca mengembalikan nilai yang sama", () => {
    writeVersioned(stringSpec(), "halo");
    expect(readVersioned(stringSpec())).toEqual({
      status: "current",
      value: "halo",
    });
  });

  it("nilai tidak bisa diserialisasi -> unavailable (tanpa melempar)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => writeVersioned(stringSpec(), circular as never)).not.toThrow();
    expect(writeVersioned(stringSpec(), circular as never)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("QuotaExceededError -> {ok:false, reason:'quota'} tanpa melempar", () => {
    const err = Object.assign(new Error("full"), {
      name: "QuotaExceededError",
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw err;
      },
      removeItem: () => undefined,
    });

    expect(() => writeVersioned(stringSpec(), "x")).not.toThrow();
    expect(writeVersioned(stringSpec(), "x")).toEqual({
      ok: false,
      reason: "quota",
    });
  });

  it("NS_ERROR_DOM_QUOTA_REACHED (Firefox) juga dikenali sebagai kuota", () => {
    const err = Object.assign(new Error("full"), {
      name: "NS_ERROR_DOM_QUOTA_REACHED",
      code: 1014,
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw err;
      },
      removeItem: () => undefined,
    });

    expect(writeVersioned(stringSpec(), "x")).toEqual({
      ok: false,
      reason: "quota",
    });
  });

  it("kegagalan setItem non-kuota -> 'unavailable'", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("storage dimatikan");
      },
      removeItem: () => undefined,
    });

    expect(writeVersioned(stringSpec(), "x")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("helper pengambil field", () => {
  it("pickString: string dipertahankan, tipe lain -> fallback", () => {
    const src = { a: "halo", b: 42, c: null };
    expect(pickString(src, "a")).toBe("halo");
    expect(pickString(src, "b", "def")).toBe("def");
    expect(pickString(src, "c", "def")).toBe("def");
    expect(pickString(src, "tidak-ada", "def")).toBe("def");
    expect(pickString(null, "a", "def")).toBe("def");
  });

  it("pickNullableString: string kosong dinormalkan ke null", () => {
    const src = { a: "halo", kosong: "", b: 42 };
    expect(pickNullableString(src, "a")).toBe("halo");
    expect(pickNullableString(src, "kosong")).toBeNull();
    expect(pickNullableString(src, "b")).toBeNull();
    expect(pickNullableString(src, "tidak-ada")).toBeNull();
    expect(pickNullableString(undefined, "a")).toBeNull();
  });

  it("pickNumber: hanya number finite; NaN/Infinity -> fallback", () => {
    const src = { a: 7, nan: Number.NaN, inf: Infinity, str: "8" };
    expect(pickNumber(src, "a", 1)).toBe(7);
    expect(pickNumber(src, "nan", 1)).toBe(1);
    expect(pickNumber(src, "inf", 1)).toBe(1);
    expect(pickNumber(src, "str", 1)).toBe(1);
    expect(pickNumber(src, "tidak-ada", 1)).toBe(1);
  });

  it("pickBoolean: hanya boolean", () => {
    const src = { a: true, b: "true", c: 1 };
    expect(pickBoolean(src, "a", false)).toBe(true);
    expect(pickBoolean(src, "b", false)).toBe(false);
    expect(pickBoolean(src, "c", true)).toBe(true);
    expect(pickBoolean(src, "tidak-ada", true)).toBe(true);
  });
});
