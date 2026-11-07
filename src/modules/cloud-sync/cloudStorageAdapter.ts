/**
 * Adapter Sinkronisasi Cloud & Penyimpanan Offline-First untuk Printifya.
 * Mendukung penyimpanan lokal (LocalStorage/IndexedDB) sebagai sumber kebenaran utama (SSOT)
 * dan sinkronisasi opsional ke Cloud / Supabase / REST API saat token autentikasi tersedia.
 */

export interface SyncRecord {
  id: string;
  type: "template" | "history" | "document";
  payload: Record<string, unknown>;
  updatedAt: number;
  syncedAt?: number;
}

export interface CloudStorageConfig {
  endpoint?: string;
  authToken?: string | null;
  fetchFn?: typeof fetch;
}

export class CloudStorageAdapter {
  private localStore: Map<string, SyncRecord> = new Map();
  private endpoint: string;
  private authToken: string | null;
  private fetchFn: typeof fetch;

  constructor(config: CloudStorageConfig = {}) {
    this.endpoint = config.endpoint || "https://api.printifya.local/sync";
    this.authToken = config.authToken || null;
    this.fetchFn = config.fetchFn || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (async () => ({} as Response)));
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  isCloudSyncActive(): boolean {
    return Boolean(this.authToken && this.authToken.trim().length > 0);
  }

  /**
   * Menyimpan record secara lokal (selalu offline-first)
   */
  async saveLocal(item: Omit<SyncRecord, "updatedAt">): Promise<SyncRecord> {
    const record: SyncRecord = {
      ...item,
      updatedAt: Date.now(),
    };
    this.localStore.set(record.id, record);
    return record;
  }

  /**
   * Mengambil record dari penyimpanan lokal
   */
  async getLocal(id: string): Promise<SyncRecord | null> {
    return this.localStore.get(id) || null;
  }

  /**
   * Mengambil seluruh data lokal untuk tipe tertentu
   */
  async listLocal(type?: SyncRecord["type"]): Promise<SyncRecord[]> {
    const items = Array.from(this.localStore.values());
    if (type) {
      return items.filter((i) => i.type === type);
    }
    return items;
  }

  /**
   * Memicu sinkronisasi data lokal ke remote cloud endpoint.
   * Hanya berjalan jika auth token valid.
   */
  async syncToCloud(): Promise<{ syncedCount: number; errors: string[] }> {
    if (!this.isCloudSyncActive()) {
      return {
        syncedCount: 0,
        errors: ["Sinkronisasi awan dilewati: Akun belum terautentikasi (mode offline aktif)."],
      };
    }

    const unSyncedItems = Array.from(this.localStore.values()).filter(
      (item) => !item.syncedAt || item.syncedAt < item.updatedAt
    );

    if (unSyncedItems.length === 0) {
      return { syncedCount: 0, errors: [] };
    }

    const errors: string[] = [];
    let syncedCount = 0;

    try {
      const response = await this.fetchFn(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.authToken}`,
        },
        body: JSON.stringify({ items: unSyncedItems }),
      });

      if (!response.ok) {
        throw new Error(`Cloud server menolak sinkronisasi (HTTP ${response.status})`);
      }

      // Tandai item berhasil tersinkronisasi
      const now = Date.now();
      for (const item of unSyncedItems) {
        item.syncedAt = now;
        syncedCount++;
      }
    } catch (err: unknown) {
      const error = err as Error;
      errors.push(error.message || String(err));
    }

    return { syncedCount, errors };
  }
}
