import { describe, it, expect, vi } from "vitest";
import { CloudStorageAdapter } from "./cloudStorageAdapter";

describe("CloudStorageAdapter (Offline-first & Cloud Sync)", () => {
  it("bekerja secara offline-first tanpa memerlukan token autentikasi", async () => {
    const adapter = new CloudStorageAdapter();
    expect(adapter.isCloudSyncActive()).toBe(false);

    const saved = await adapter.saveLocal({
      id: "doc-1",
      type: "document",
      payload: { title: "Surat Perjanjian", pages: 2 },
    });

    expect(saved.id).toBe("doc-1");
    expect(saved.updatedAt).toBeGreaterThan(0);

    const retrieved = await adapter.getLocal("doc-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.payload.title).toBe("Surat Perjanjian");
  });

  it("melewati sinkronisasi cloud dan mengembalikan pesan ramah saat belum login", async () => {
    const adapter = new CloudStorageAdapter();
    await adapter.saveLocal({
      id: "hist-1",
      type: "history",
      payload: { printer: "EPSON L3110", status: "ok" },
    });

    const syncRes = await adapter.syncToCloud();
    expect(syncRes.syncedCount).toBe(0);
    expect(syncRes.errors[0]).toContain("mode offline aktif");
  });

  it("mengunggah data yang belum tersinkronisasi saat auth token aktif", async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })) as unknown as typeof fetch;

    const adapter = new CloudStorageAdapter({
      authToken: "jwt-token-rahasia-123",
      fetchFn: mockFetch,
    });

    expect(adapter.isCloudSyncActive()).toBe(true);

    await adapter.saveLocal({
      id: "tmpl-1",
      type: "template",
      payload: { name: "Nota Kontan Ukuran 58mm" },
    });

    const syncRes = await adapter.syncToCloud();
    expect(syncRes.syncedCount).toBe(1);
    expect(syncRes.errors.length).toBe(0);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.printifya.local/sync",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer jwt-token-rahasia-123",
        }),
      })
    );

    // Pemanggilan kedua tidak mengunggah ulang item yang sudah di-sync
    const secondSync = await adapter.syncToCloud();
    expect(secondSync.syncedCount).toBe(0);
  });

  it("menangani kegagalan jaringan HTTP cloud secara graceful tanpa merusak data lokal", async () => {
    const failingFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "Server Unavailable" }),
    })) as unknown as typeof fetch;

    const adapter = new CloudStorageAdapter({
      authToken: "token-valid",
      fetchFn: failingFetch,
    });

    await adapter.saveLocal({
      id: "doc-fail",
      type: "document",
      payload: { data: "test" },
    });

    const res = await adapter.syncToCloud();
    expect(res.syncedCount).toBe(0);
    expect(res.errors[0]).toContain("503");

    // Data lokal tetap utuh dan aman
    const local = await adapter.getLocal("doc-fail");
    expect(local).not.toBeNull();
    expect(local?.syncedAt).toBeUndefined();
  });
});
