import { describe, expect, it } from "vitest";
import { shouldRevokeBlobUrl } from "./downloadUrl";

describe("shouldRevokeBlobUrl — kebijakan revoke terpusat", () => {
  it("URL blob: default → revoke", () => {
    expect(shouldRevokeBlobUrl("blob:http://localhost/abc-123")).toBe(true);
  });

  it("URL data: default → tidak di-revoke (inline, tanpa sumber daya)", () => {
    expect(shouldRevokeBlobUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(
      false
    );
  });

  it("skema lain (http/https) default → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("https://example.com/foto.png")).toBe(false);
  });

  it("opts.revoke memaksa: blob: dengan revoke:false → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("blob:http://localhost/x", { revoke: false })).toBe(
      false
    );
  });

  it("opts.revoke memaksa: data: dengan revoke:true → di-revoke", () => {
    expect(shouldRevokeBlobUrl("data:image/png;base64,AA==", { revoke: true })).toBe(
      true
    );
  });

  it("string kosong → tidak di-revoke", () => {
    expect(shouldRevokeBlobUrl("")).toBe(false);
  });
});
