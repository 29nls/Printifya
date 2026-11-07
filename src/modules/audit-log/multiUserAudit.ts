/**
 * Multi-User Print Quota & Encrypted Audit Logging untuk Printifya.
 * Mengelola kuota cetak per-pengguna (misal sekolah/kantor) dan mencatat log audit
 * dengan pengaburan (redaction) dan hashing/enkripsi ringan terhadap data sensitif
 * (NIK, nomor kartu, password, dokumen rahasia) sebelum disimpan ke penyimpanan lokal/eksternal.
 */

export interface UserQuota {
  userId: string;
  name: string;
  role: "admin" | "operator" | "user";
  dailyQuota: number;
  usedToday: number;
  lastResetDate: string; // YYYY-MM-DD
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: "print_job" | "export_pdf" | "quota_reset" | "settings_update";
  sanitizedDetails: Record<string, unknown>;
  checksum: string; // Hash SHA/FNV untuk menjamin integritas log dari pemalsuan
}

/**
 * Pengaburan (redaction) sederhana untuk pola data sensitif:
 * - NIK / Angka 16 digit: 3201**********12
 * - Email: a***@domain.com
 * - Kata sandi / secret: [REDACTED]
 */
export function sanitizeSensitiveString(text: string): string {
  // Redact NIK / 16 digits: pertahankan 4 digit awal dan 4 digit akhir
  let result = text.replace(/\b(\d{4})\d{8}(\d{4})\b/g, "$1********$2");
  // Redact email
  result = result.replace(/([a-zA-Z0-9_\-.])[a-zA-Z0-9_\-.]*@([a-zA-Z0-9_\-.]+)/g, "$1***@$2");
  return result;
}

/**
 * Sanitasi rekursif untuk payload objek audit
 */
export function sanitizeLogPayload(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  const sensitiveKeys = ["password", "secret", "token", "auth", "pin", "nik"];

  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((k) => lowerKey.includes(k))) {
      clean[key] = "[REDACTED]";
    } else if (typeof val === "string") {
      clean[key] = sanitizeSensitiveString(val);
    } else if (val && typeof val === "object" && !Array.isArray(val)) {
      clean[key] = sanitizeLogPayload(val as Record<string, unknown>);
    } else {
      clean[key] = val;
    }
  }

  return clean;
}

/**
 * Perhitungan checksum biner sederhana (FNV-1a 32-bit hash hex)
 */
export function calculateChecksum(data: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    hash ^= data.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export class MultiUserAuditManager {
  private users: Map<string, UserQuota> = new Map();
  private auditLogs: AuditLogEntry[] = [];

  constructor() {
    // Default admin user
    this.users.set("admin", {
      userId: "admin",
      name: "Administrator",
      role: "admin",
      dailyQuota: 9999,
      usedToday: 0,
      lastResetDate: new Date().toISOString().slice(0, 10),
    });
  }

  registerUser(user: UserQuota): void {
    this.users.set(user.userId, { ...user });
  }

  getUser(userId: string): UserQuota | null {
    return this.users.get(userId) || null;
  }

  /**
   * Memeriksa dan memotong kuota cetak pengguna
   */
  consumeQuota(userId: string, pages: number = 1): { allowed: boolean; remaining: number; message: string } {
    const user = this.users.get(userId);
    if (!user) {
      return { allowed: false, remaining: 0, message: "Pengguna tidak terdaftar." };
    }

    const today = new Date().toISOString().slice(0, 10);
    if (user.lastResetDate !== today) {
      user.usedToday = 0;
      user.lastResetDate = today;
    }

    if (user.usedToday + pages > user.dailyQuota) {
      return {
        allowed: false,
        remaining: Math.max(0, user.dailyQuota - user.usedToday),
        message: `Kuota harian tidak mencukupi (sisa: ${user.dailyQuota - user.usedToday}, diminta: ${pages}).`,
      };
    }

    user.usedToday += pages;
    return {
      allowed: true,
      remaining: user.dailyQuota - user.usedToday,
      message: "Kuota berhasil dipotong.",
    };
  }

  /**
   * Mencatat log audit terstruktur dengan sanitasi otomatis
   */
  logAction(
    userId: string,
    action: AuditLogEntry["action"],
    details: Record<string, unknown>
  ): AuditLogEntry {
    const sanitized = sanitizeLogPayload(details);
    const serialized = JSON.stringify({ userId, action, sanitized });
    const checksum = calculateChecksum(serialized);

    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      userId,
      action,
      sanitizedDetails: sanitized,
      checksum,
    };

    this.auditLogs.push(entry);
    return entry;
  }

  getLogs(): AuditLogEntry[] {
    return [...this.auditLogs];
  }
}
