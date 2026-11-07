import { describe, it, expect, beforeEach } from "vitest";
import {
  MultiUserAuditManager,
  sanitizeSensitiveString,
  sanitizeLogPayload,
} from "./multiUserAudit";

describe("MultiUserAuditManager (Quota & Sanitized Audit Logging)", () => {
  let manager: MultiUserAuditManager;

  beforeEach(() => {
    manager = new MultiUserAuditManager();
    manager.registerUser({
      userId: "user-guru-1",
      name: "Budi Santoso",
      role: "user",
      dailyQuota: 50,
      usedToday: 48,
      lastResetDate: new Date().toISOString().slice(0, 10),
    });
  });

  it("melakukan redaction otomatis terhadap NIK 16 digit dan email", () => {
    const raw = "Cetak KTP untuk NIK 3201012345670001 dan konfirmasi ke budi.santoso@sekolah.sch.id";
    const sanitized = sanitizeSensitiveString(raw);

    expect(sanitized).not.toContain("3201012345670001");
    expect(sanitized).toContain("3201********0001");
    expect(sanitized).not.toContain("budi.santoso@sekolah");
    expect(sanitized).toContain("b***@sekolah.sch.id");
  });

  it("menyembunyikan field password / token / secret di dalam payload audit log", () => {
    const payload = {
      printer: "EPSON L3110",
      jobToken: "bearer-secret-xyz-123",
      passwordHash: "plain-pass",
      studentInfo: "Siswa NIK 3171012345678901",
    };

    const clean = sanitizeLogPayload(payload);
    expect(clean.jobToken).toBe("[REDACTED]");
    expect(clean.passwordHash).toBe("[REDACTED]");
    expect(clean.printer).toBe("EPSON L3110");
    expect(String(clean.studentInfo)).toContain("3171********8901");
  });

  it("memotong kuota harian pengguna dan menolak jika melebihi kuota", () => {
    // Kuota tersisa = 50 - 48 = 2 halaman
    const okRes = manager.consumeQuota("user-guru-1", 2);
    expect(okRes.allowed).toBe(true);
    expect(okRes.remaining).toBe(0);

    // Permintaan berikutnya harus ditolak
    const failRes = manager.consumeQuota("user-guru-1", 1);
    expect(failRes.allowed).toBe(false);
    expect(failRes.remaining).toBe(0);
    expect(failRes.message).toContain("tidak mencukupi");
  });

  it("mencatat log audit dengan checksum integritas", () => {
    const entry = manager.logAction("user-guru-1", "print_job", {
      docName: "Ujian Akhir Semester",
      tokenAdmin: "super-secret-123",
      pages: 2,
    });

    expect(entry.userId).toBe("user-guru-1");
    expect(entry.sanitizedDetails.tokenAdmin).toBe("[REDACTED]");
    expect(entry.checksum).toBeDefined();
    expect(entry.checksum.length).toBe(8); // 8-char hex hash

    const logs = manager.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].id).toBe(entry.id);
  });
});
