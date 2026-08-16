import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingPasFoto,
  peekPendingPasFoto,
  setPendingPasFoto,
} from "./pasFotoBridge";

// Kontrak jembatan pas foto: seam in-memory tunggal yang dipakai semua tombol
// "Jadikan Pas Foto 3x4" antar modul. Modul tujuan memakai peek-then-clear
// saat mount (aman terhadap double-mount StrictMode) — peek TIDAK boleh
// mengosongkan.

beforeEach(() => {
  clearPendingPasFoto();
});

describe("pasFotoBridge — kontrak terusan ke modul pas foto", () => {
  it("peek saat kosong → null (bukan string kosong)", () => {
    expect(peekPendingPasFoto()).toBeNull();
  });

  it("set → peek mengembalikan nilai yang sama; peek TIDAK menghapus", () => {
    setPendingPasFoto("data:image/png;base64,AAA");
    expect(peekPendingPasFoto()).toBe("data:image/png;base64,AAA");
    // Pemanggilan peek kedua (mis. double-mount) tetap mengembalikan nilai.
    expect(peekPendingPasFoto()).toBe("data:image/png;base64,AAA");
  });

  it("set menimpa nilai sebelumnya", () => {
    setPendingPasFoto("data:image/png;base64,AAA");
    setPendingPasFoto("data:image/png;base64,BBB");
    expect(peekPendingPasFoto()).toBe("data:image/png;base64,BBB");
  });

  it("set(null) menghapus nilai (pembersihan eksplisit)", () => {
    setPendingPasFoto("data:image/png;base64,AAA");
    setPendingPasFoto(null);
    expect(peekPendingPasFoto()).toBeNull();
  });

  it("clear → kosong; peek-then-clear dua kali → tetap kosong", () => {
    setPendingPasFoto("data:image/png;base64,AAA");
    clearPendingPasFoto();
    expect(peekPendingPasFoto()).toBeNull();
    clearPendingPasFoto(); // idempoten
    expect(peekPendingPasFoto()).toBeNull();
  });

  it("nilai persisten antar panggilan dalam satu sesi (variabel in-memory)", () => {
    setPendingPasFoto("data:image/png;base64,AAA");
    // Konsumen terpisah (mis. navigasi antar modul tanpa reload) membaca ulang.
    expect(peekPendingPasFoto()).toBe("data:image/png;base64,AAA");
    expect(peekPendingPasFoto()).toBe("data:image/png;base64,AAA");
  });
});
