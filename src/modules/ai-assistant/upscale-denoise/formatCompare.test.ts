import { describe, expect, it } from "vitest";
import {
  decideFormatToggle,
  type FormatSession,
  type FormatToggleItem,
} from "./formatCompare";
import type { FormatStat } from "./waifu2x";

const item = (id: string, formats?: FormatStat[] | null): FormatToggleItem => ({
  id,
  formats,
});

const session = (openId: string | null, loading: string[] = []): FormatSession => ({
  openId,
  loading: new Set(loading),
});

/** Setelah komputasi selesai: hasil tersimpan di item, loading bersih. */
const done = (id: string): FormatToggleItem => item(id, [] as FormatStat[]);

describe("decideFormatToggle — cache & guard per-id", () => {
  it("buka item yang belum pernah dihitung → mulai komputasi", () => {
    expect(decideFormatToggle(item("a"), session(null))).toEqual({
      action: "compute",
    });
  });

  it("klik item yang sedang terbuka → tutup panel", () => {
    expect(decideFormatToggle(item("a"), session("a"))).toEqual({
      action: "close",
    });
  });

  it("item dengan hasil tersimpan → cached (buka ulang instan, tanpa hitung ulang)", () => {
    expect(decideFormatToggle(done("a"), session(null))).toEqual({
      action: "cached",
    });
  });

  it("item yang sedang dihitung → in-flight (guard per-id)", () => {
    expect(decideFormatToggle(item("a"), session(null, ["a"]))).toEqual({
      action: "in-flight",
    });
  });

  it("guard per-id tidak menghalangi item lain yang belum dihitung", () => {
    // A sedang menghitung, tapi B independen → B boleh mulai.
    expect(decideFormatToggle(item("b"), session("a", ["a"]))).toEqual({
      action: "compute",
    });
  });

  it("konkurensi A→B→A: klik ulang A saat keduanya in-flight TIDAK mulai komputasi duplikat", () => {
    // Skenario cacat yang diperbaiki review: dengan flag tunggal, klik A → B → A
    // menembus guard dan memulai compareFormats kedua untuk A.
    const first = decideFormatToggle(item("a"), session(null));
    expect(first).toEqual({ action: "compute" });

    // B dibuka & mulai menghitung (A masih in-flight).
    expect(decideFormatToggle(item("b"), session("a", ["a"]))).toEqual({
      action: "compute",
    });

    // Klik A lagi sementara A & B keduanya in-flight → in-flight, BUKAN compute.
    const reOpen = decideFormatToggle(item("a"), session("b", ["a", "b"]));
    expect(reOpen).toEqual({ action: "in-flight" });
  });

  it("cache dipakai bila hasil tersimpan meski id masih tercatat loading (tepat setelah selesai)", () => {
    // Komputasi A selesai (formats tersimpan) tapi finally belum membersihkan
    // loading; klik ulang A (panel tertutup) tidak boleh menghitung ulang.
    expect(decideFormatToggle(done("a"), session(null, ["a"]))).toEqual({
      action: "cached",
    });
  });

  it("urutan lengkap: buka → tutup → buka ulang → cached (tidak menghitung ulang)", () => {
    let f: FormatSession = session(null);
    const a = item("a");

    // Buka pertama → compute.
    expect(decideFormatToggle(a, f)).toEqual({ action: "compute" });
    f = { openId: "a", loading: new Set(["a"]) };

    // Klik lagi (masih terbuka & menghitung) → tutup.
    expect(decideFormatToggle(a, f)).toEqual({ action: "close" });
    f = session(null);

    // Buka ulang dengan hasil tersimpan → cached.
    expect(decideFormatToggle(done("a"), f)).toEqual({ action: "cached" });
  });
});
