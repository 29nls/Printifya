import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEAF_MODULES, MODULES, findModule, type Module } from "./registry";

/**
 * Penjaga bentuk registry.
 *
 * `App.tsx` membangun satu `<Route>` untuk setiap entri `MODULES` dan
 * `LEAF_MODULES`, jadi "punya rute" berarti "punya `path` yang sah dan unik".
 * Tipe `Module` sudah mewajibkan `Component`, tetapi `null as unknown as
 * ComponentType` pernah lolos ke rilis (`88b0203`), dan akibatnya baru terlihat
 * sebagai peringatan React di setiap halaman plus satu rute yang kosong. Tipe
 * tidak bisa menangkap itu; tes ini yang bisa.
 */

interface Entry {
  module: Module;
  parent?: Module;
  /** Label ringkas untuk pesan kegagalan. */
  where: string;
}

const ENTRIES: Entry[] = MODULES.flatMap((m) => [
  { module: m, where: `grup "${m.id}"` },
  ...(m.children ?? []).map((c) => ({
    module: c,
    parent: m,
    where: `"${m.id}" > "${c.id}"`,
  })),
]);

/**
 * Komponen bisa dirender bila berupa fungsi (komponen biasa) atau objek React
 * bertanda-simbol. `React.lazy()`, `memo()`, dan `forwardRef()` mengembalikan
 * `{ $$typeof: Symbol(...) }`, bukan fungsi — itulah bentuk hampir semua
 * halaman di registry ini. `null` dan `undefined` gugur di sini; itulah inti
 * tes ini.
 */
function isRenderable(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as { $$typeof?: unknown }).$$typeof === "symbol";
}

/** `path` rute yang sah: absolut, tanpa spasi, tanpa garis miring di ujung. */
function isRoutablePath(path: unknown): boolean {
  if (typeof path !== "string" || path === "") return false;
  if (!path.startsWith("/")) return false;
  if (path === "/") return false; // "/" milik Beranda, bukan modul.
  if (path.length > 1 && path.endsWith("/")) return false;
  return !/\s/.test(path);
}

describe("registry — setiap entri bisa dirender dan punya rute", () => {
  it("ada entri untuk diperiksa (tes tidak diam-diam kosong)", () => {
    expect(MODULES.length).toBeGreaterThan(0);
    expect(ENTRIES.length).toBeGreaterThan(MODULES.length);
  });

  it("setiap modul dan grup punya Component yang bisa dirender", () => {
    const rusak = ENTRIES.filter((e) => !isRenderable(e.module.Component)).map(
      (e) => `${e.where} → Component = ${String(e.module.Component)}`
    );
    expect(rusak, "Component null/bukan komponen akan gagal dirender").toEqual(
      []
    );
  });

  it("setiap modul dan grup punya path rute yang sah", () => {
    const rusak = ENTRIES.filter((e) => !isRoutablePath(e.module.path)).map(
      (e) => `${e.where} → path = ${JSON.stringify(e.module.path)}`
    );
    expect(rusak, "path tidak sah menghasilkan Route yang tidak cocok").toEqual(
      []
    );
  });

  it("path tidak ada yang duplikat (rute tidak saling menimpa)", () => {
    const seen = new Map<string, string>();
    const bentrok: string[] = [];
    for (const e of ENTRIES) {
      const first = seen.get(e.module.path);
      if (first) bentrok.push(`${e.module.path}: ${first} vs ${e.where}`);
      else seen.set(e.module.path, e.where);
    }
    expect(bentrok, "rute duplikat membuat salah satu halaman tak terjangkau").toEqual(
      []
    );
  });

  it("id tidak ada yang duplikat (kunci React & pencarian modul tetap unik)", () => {
    const seen = new Map<string, string>();
    const bentrok: string[] = [];
    for (const e of ENTRIES) {
      const first = seen.get(e.module.id);
      if (first) bentrok.push(`${e.module.id}: ${first} vs ${e.where}`);
      else seen.set(e.module.id, e.where);
    }
    expect(bentrok, "id duplikat membuat React key dan findModule ambigu").toEqual(
      []
    );
  });

  it("setiap grup punya anak, dan path anak berada di bawah path grupnya", () => {
    const rusak: string[] = [];
    for (const m of MODULES) {
      if (!m.children || m.children.length === 0) {
        // Halaman arahan grup tidak akan menampilkan satu kartu pun.
        rusak.push(`grup "${m.id}" tanpa anak`);
        continue;
      }
      for (const c of m.children) {
        if (!c.path.startsWith(`${m.path}/`)) {
          rusak.push(
            `"${c.id}" path ${c.path} tidak di bawah grup ${m.path}`
          );
        }
      }
    }
    expect(rusak).toEqual([]);
  });

  it("judul, ikon, dan deskripsi terisi (semuanya dirender di sidebar/arahan)", () => {
    const rusak: string[] = [];
    for (const e of ENTRIES) {
      for (const field of ["title", "icon", "description"] as const) {
        const value = e.module[field];
        if (typeof value !== "string" || value.trim() === "") {
          rusak.push(`${e.where} → ${field} kosong`);
        }
      }
    }
    expect(rusak).toEqual([]);
  });

  it("findModule mengembalikan entri yang benar untuk setiap path", () => {
    const rusak: string[] = [];
    for (const e of ENTRIES) {
      if (findModule(e.module.path) !== e.module) {
        rusak.push(`${e.where} → findModule("${e.module.path}") tidak cocok`);
      }
    }
    expect(rusak).toEqual([]);
  });

  it("LEAF_MODULES sama persis dengan gabungan anak semua grup", () => {
    const dariGrup = MODULES.flatMap((m) => m.children ?? []);
    expect(LEAF_MODULES.map((l) => l.path)).toEqual(dariGrup.map((l) => l.path));
    // Identitas, bukan sekadar bentuk: Route per daun memakai komponen ini.
    LEAF_MODULES.forEach((leaf, i) => {
      expect(leaf).toBe(dariGrup[i]);
    });
  });
});

describe("registry — halaman arahan grup menunjuk grup yang ada", () => {
  /**
   * `ModuleOverview` mengembalikan `null` bila `moduleId` tidak ditemukan, jadi
   * salah ketik id menghasilkan halaman kosong tanpa error apa pun. Itu kelas
   * kegagalan senyap yang sama dengan Component null, hanya tanpa peringatan.
   */
  it("moduleId di setiap <grup>/index.tsx cocok dengan id grupnya", () => {
    const rusak: string[] = [];
    for (const m of MODULES) {
      const berkas = new URL(`./${m.id}/index.tsx`, import.meta.url);
      let sumber: string;
      try {
        sumber = readFileSync(berkas, "utf8");
      } catch {
        rusak.push(`grup "${m.id}" → ${m.id}/index.tsx tidak ada`);
        continue;
      }
      const cocok = sumber.match(/moduleId="([^"]*)"/);
      if (!cocok) {
        rusak.push(`grup "${m.id}" → moduleId tidak ditemukan di index.tsx`);
      } else if (cocok[1] !== m.id) {
        rusak.push(
          `grup "${m.id}" → index.tsx menunjuk moduleId="${cocok[1]}"`
        );
      }
    }
    expect(rusak, "moduleId salah → halaman arahan kosong tanpa error").toEqual(
      []
    );
  });
});
