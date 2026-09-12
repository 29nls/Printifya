import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LetterFields } from "./letterHtml";
import {
  loadArchive,
  loadDraft,
  MAX_ARCHIVE_BYTES,
  MAX_LOGO_CHARS,
  pruneArchive,
  saveArchive,
  saveDraft,
  type ArchiveEntry,
} from "./storage";

const DRAFT_KEY = "printifya.letter-draft";
const ARCHIVE_KEY = "printifya.letter-archive";

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

function letter(overrides: Partial<LetterFields> = {}): LetterFields {
  return {
    instansi: "PT Test",
    alamat: "Jl. Test",
    logo: null,
    kode: "TEST",
    seq: 1,
    tanggal: "2026-01-01",
    lampiran: "",
    perihal: "Perihal",
    kepada: "Bapak",
    isi: "Isi surat",
    penutup: "Penutup",
    nama: "Nama",
    jabatan: "Jabatan",
    ...overrides,
  };
}

function entry(id: string, overrides: Partial<LetterFields> = {}): ArchiveEntry {
  return {
    id,
    savedAt: "2026-01-01T00:00:00.000Z",
    data: letter(overrides),
  };
}

describe("loadArchive — tanpa data", () => {
  it("kosong: bukan unreadable, bukan locked", () => {
    const load = loadArchive();
    expect(load.entries).toEqual([]);
    expect(load.unreadable).toBe(false);
    expect(load.locked).toBe(false);
    expect(load.dropped).toBe(0);
  });
});

describe("loadArchive — validasi per entri", () => {
  it("entri rusak dibuang, entri valid tetap ada", () => {
    // Data lama v1 (tanpa envelope).
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([
        { id: "a", savedAt: "2026-01-01T00:00:00.000Z", data: letter({ perihal: "Baik" }) },
        { id: "b", savedAt: "2026-01-01T00:00:00.000Z", data: "bukan objek" },
        { id: "c", savedAt: "2026-01-01T00:00:00.000Z" },
        "bukan entri",
      ])
    );

    const load = loadArchive();
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0].data.perihal).toBe("Baik");
    expect(load.dropped).toBe(3);
  });

  it("entri tanpa id/tanggal diperbaiki, bukan dibuang", () => {
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([{ data: letter({ perihal: "Tanpa Id" }) }])
    );

    const load = loadArchive();
    expect(load.entries).toHaveLength(1);
    expect(load.dropped).toBe(0);
    expect(load.entries[0].id).toBe("legacy-0");
    expect(load.entries[0].savedAt).toBe("");
    expect(load.entries[0].data.perihal).toBe("Tanpa Id");
  });

  it("field bertipe salah jatuh ke default, surat tidak hilang", () => {
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([
        {
          id: "a",
          savedAt: "2026-01-01T00:00:00.000Z",
          data: { perihal: "X", seq: "bukan angka", isi: 42 },
        },
      ])
    );

    const load = loadArchive();
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0].data.seq).toBe(1);
    expect(load.entries[0].data.isi).toBe("");
    expect(load.entries[0].data.perihal).toBe("X");
  });

  it("data tersimpan bukan array -> unreadable, bukan pengguna baru", () => {
    store.map.set(ARCHIVE_KEY, JSON.stringify({ v: 1, d: "bukan array" }));
    const load = loadArchive();
    expect(load.unreadable).toBe(true);
    expect(load.entries).toEqual([]);
  });
});

describe("loadArchive — migrasi v1 ke v2 (logo kebesaran)", () => {
  it("logo di atas ambang dilepas, field lain utuh", () => {
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([
        entry("a", { logo: "x".repeat(MAX_LOGO_CHARS + 1), perihal: "Surat Penting" }),
      ])
    );

    const load = loadArchive();
    expect(load.removedLogos).toBe(1);
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0].data.logo).toBeNull();
    expect(load.entries[0].data.perihal).toBe("Surat Penting");
  });

  it("logo di bawah ambang dipertahankan", () => {
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([entry("a", { logo: "x".repeat(1000) })])
    );

    const load = loadArchive();
    expect(load.removedLogos).toBe(0);
    expect(load.entries[0].data.logo).toHaveLength(1000);
  });

  it("hanya entri berlogo kebesaran yang dilepas logonya", () => {
    store.map.set(
      ARCHIVE_KEY,
      JSON.stringify([
        entry("a", { logo: "x".repeat(MAX_LOGO_CHARS + 1) }),
        entry("b", { logo: "y".repeat(500) }),
        entry("c"),
      ])
    );

    const load = loadArchive();
    expect(load.removedLogos).toBe(1);
    expect(load.entries[0].data.logo).toBeNull();
    expect(load.entries[1].data.logo).toHaveLength(500);
    expect(load.entries[2].data.logo).toBeNull();
  });
});

describe("loadArchive — anggaran byte", () => {
  it("banyak logo sedang yang lolos ambang tetap dipangkas agar muat", () => {
    // Logo 200.000 char: di bawah MAX_LOGO_CHARS, jadi migrasi logo tidak
    // menyentuhnya — tanpa pemangkasan byte, 12 entri ini melebihi kuota.
    const logo = "x".repeat(200_000);
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry(`e${i}`, { logo })
    );
    store.map.set(ARCHIVE_KEY, JSON.stringify(entries));

    const load = loadArchive();
    const total = load.entries.reduce(
      (n, e) => n + JSON.stringify(e).length,
      0
    );

    expect(load.removedLogos).toBe(0);
    expect(load.entries.length).toBeLessThan(12);
    expect(total).toBeLessThanOrEqual(MAX_ARCHIVE_BYTES);
    // Terbaru dipertahankan (daftar tersusun terbaru dulu).
    expect(load.entries[0].id).toBe("e0");
    expect(load.evicted).toBe(12 - load.entries.length);
    expect(load.dropped).toBe(0);
  });

  it("pruneArchive melewati entri raksasa tanpa membuang entri di belakangnya", () => {
    const entries = [
      entry("huge", { logo: "x".repeat(MAX_ARCHIVE_BYTES + 10) }),
      entry("kecil-1"),
      entry("kecil-2"),
      entry("kecil-3"),
    ];

    const result = pruneArchive(entries);
    expect(result.map((e) => e.id)).toEqual(["kecil-1", "kecil-2", "kecil-3"]);
  });
});

describe("saveArchive / saveDraft — envelope dan bolak-balik", () => {
  it("saveArchive menulis envelope versi 2 dan bisa dibaca kembali", () => {
    const entries = [entry("a")];
    expect(saveArchive(entries)).toEqual({ ok: true });

    expect(JSON.parse(store.map.get(ARCHIVE_KEY) ?? "null")).toMatchObject({
      v: 2,
    });

    const load = loadArchive();
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0].data.perihal).toBe("Perihal");
    expect(load.dropped).toBe(0);
    expect(load.removedLogos).toBe(0);
  });

  it("saveDraft lalu loadDraft mengembalikan surat yang sama", () => {
    const fields = letter({ perihal: "Draf Saya", seq: 7 });
    expect(saveDraft(fields)).toEqual({ ok: true });

    const load = loadDraft();
    expect(load.fields).toEqual(fields);
    expect(load.unreadable).toBe(false);
    expect(load.removedLogo).toBe(false);
  });

  it("storage penuh -> {ok:false, reason:'quota'} tanpa melempar", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
      removeItem: () => undefined,
    });

    expect(() => saveArchive([entry("a")])).not.toThrow();
    expect(saveArchive([entry("a")])).toEqual({ ok: false, reason: "quota" });
  });
});

describe("loadDraft — migrasi logo", () => {
  it("draf lama berlogo kebesaran: logo dilepas, field lain utuh", () => {
    store.map.set(
      DRAFT_KEY,
      JSON.stringify({
        ...letter({ perihal: "Surat Penting" }),
        logo: "x".repeat(MAX_LOGO_CHARS + 1),
      })
    );

    const load = loadDraft();
    expect(load.removedLogo).toBe(true);
    expect(load.unreadable).toBe(false);
    expect(load.fields?.logo).toBeNull();
    expect(load.fields?.perihal).toBe("Surat Penting");
  });

  it("logo di bawah ambang tidak dilepas", () => {
    store.map.set(DRAFT_KEY, JSON.stringify(letter({ logo: "x".repeat(1000) })));

    const load = loadDraft();
    expect(load.removedLogo).toBe(false);
    expect(load.fields?.logo).toHaveLength(1000);
  });

  it("draf tersimpan bukan objek -> unreadable", () => {
    store.map.set(DRAFT_KEY, JSON.stringify([1, 2, 3]));
    const load = loadDraft();
    expect(load.unreadable).toBe(true);
    expect(load.fields).toBeNull();
  });
});

describe("data dari versi aplikasi yang lebih baru", () => {
  it("draf: locked, tanpa tulis, storage utuh", () => {
    const raw = JSON.stringify({ v: 9, d: letter() });
    store.map.set(DRAFT_KEY, raw);

    const load = loadDraft();
    expect(load.locked).toBe(true);
    expect(load.fields).toBeNull();
    expect(store.map.get(DRAFT_KEY)).toBe(raw);
  });

  it("riwayat: locked, tanpa tulis, storage utuh", () => {
    const raw = JSON.stringify({ v: 9, d: [entry("a")] });
    store.map.set(ARCHIVE_KEY, raw);

    const load = loadArchive();
    expect(load.locked).toBe(true);
    expect(load.entries).toEqual([]);
    expect(store.map.get(ARCHIVE_KEY)).toBe(raw);
  });
});
