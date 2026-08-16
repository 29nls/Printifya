import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPendingLayoutPhotos,
  peekPendingLayoutPhotos,
  setPendingLayoutPhoto,
  setPendingLayoutPhotos,
} from "./autoLayoutBridge";

// Kontrak jembatan Auto Layout: daftar foto in-memory untuk tombol
// "Susun ke Lembar A4" (satu foto atau batch beberapa orang). Konsumen
// memakai peek-then-clear saat mount — peek TIDAK boleh mengosongkan.

beforeEach(() => {
  clearPendingLayoutPhotos();
});

describe("autoLayoutBridge — kontrak terusan ke Auto Layout", () => {
  it("peek saat kosong → null (bukan [])", () => {
    expect(peekPendingLayoutPhotos()).toBeNull();
  });

  it("setPendingLayoutPhotos → peek mengembalikan batch yang sama; TIDAK menghapus", () => {
    const items = [
      { url: "data:image/png;base64,AAA", name: "orang-1" },
      { url: "data:image/png;base64,BBB", name: "orang-2" },
    ];
    setPendingLayoutPhotos(items);
    expect(peekPendingLayoutPhotos()).toEqual(items);
    // peek kedua (double-mount StrictMode) tetap utuh.
    expect(peekPendingLayoutPhotos()).toEqual(items);
  });

  it("setPendingLayoutPhoto (tunggal) → batch satu item dengan url+name", () => {
    setPendingLayoutPhoto("data:image/png;base64,CCC", "bg-foto");
    expect(peekPendingLayoutPhotos()).toEqual([
      { url: "data:image/png;base64,CCC", name: "bg-foto" },
    ]);
  });

  it("batch multi-item mempertahankan urutan & kedua field", () => {
    const items = [
      { url: "u1", name: "a" },
      { url: "u2", name: "b" },
      { url: "u3", name: "c" },
    ];
    setPendingLayoutPhotos(items);
    const got = peekPendingLayoutPhotos()!;
    expect(got).toHaveLength(3);
    expect(got.map((p) => p.name)).toEqual(["a", "b", "c"]);
    expect(got.map((p) => p.url)).toEqual(["u1", "u2", "u3"]);
  });

  it("set berikutnya menimpa batch sebelumnya", () => {
    setPendingLayoutPhotos([
      { url: "u1", name: "a" },
      { url: "u2", name: "b" },
    ]);
    setPendingLayoutPhoto("u3", "c");
    expect(peekPendingLayoutPhotos()).toEqual([{ url: "u3", name: "c" }]);
  });

  it("clear → kosong; peek-then-clear dua kali → tetap kosong (idempoten)", () => {
    setPendingLayoutPhotos([{ url: "u1", name: "a" }]);
    clearPendingLayoutPhotos();
    expect(peekPendingLayoutPhotos()).toBeNull();
    clearPendingLayoutPhotos();
    expect(peekPendingLayoutPhotos()).toBeNull();
  });

  it("nilai persisten antar panggilan dalam satu sesi (variabel in-memory)", () => {
    setPendingLayoutPhotos([
      { url: "u1", name: "a" },
      { url: "u2", name: "b" },
    ]);
    // Konsumen terpisah membaca ulang tanpa reload.
    expect(peekPendingLayoutPhotos()).toHaveLength(2);
    expect(peekPendingLayoutPhotos()?.[0].name).toBe("a");
  });
});
