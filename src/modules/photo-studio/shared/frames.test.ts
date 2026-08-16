import { describe, expect, it } from "vitest";
import { coverFitRect, FRAMES, getFrame, validFrameId } from "./frames";

/**
 * Konteks 2D rekaman: setiap panggilan metode (termasuk penugasan fillStyle)
 * dicatat berurutan ke `ops` — memungkinkan verifikasi geometri path tanpa
 * canvas sungguhan.
 */
type Op = { name: string; args: unknown[] };

function makeCtx(): { ctx: CanvasRenderingContext2D; ops: Op[] } {
  const ops: Op[] = [];
  let fill = "";
  let fontStr = "10px Arial, sans-serif";
  const record = (name: string) => (...args: unknown[]) => {
    ops.push({ name, args });
  };
  const gradient = { addColorStop: record("addColorStop") };
  const ctx: Record<string, unknown> = {
    strokeStyle: "",
    lineWidth: 1,
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    arcTo: record("arcTo"),
    lineTo: record("lineTo"),
    closePath: record("closePath"),
    fill: record("fill"),
    stroke: record("stroke"),
    strokeRect: record("strokeRect"),
    arc: record("arc"),
    bezierCurveTo: record("bezierCurveTo"),
    quadraticCurveTo: record("quadraticCurveTo"),
    translate: record("translate"),
    rotate: record("rotate"),
    rect: record("rect"),
    clip: record("clip"),
    save: record("save"),
    restore: record("restore"),
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    createLinearGradient: (...args: unknown[]) => {
      ops.push({ name: "createLinearGradient", args });
      return gradient;
    },
    // Lebar teks deterministik: proporsional terhadap ukuran font saat ini
    // (rata-rata glif Arial tebal ≈ 0.6 × ukuran) — dipakai menguji shrink.
    measureText: (text: string) => {
      ops.push({ name: "measureText", args: [text] });
      const m = /(\d+(?:\.\d+)?)px/.exec(fontStr);
      const px = m ? parseFloat(m[1]) : 10;
      return { width: text.length * px * 0.6 };
    },
  };
  Object.defineProperty(ctx, "fillStyle", {
    get: () => fill,
    set: (v: unknown) => {
      fill = String(v);
      ops.push({ name: "fillStyle", args: [fill] });
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(ctx, "font", {
    get: () => fontStr,
    set: (v: unknown) => {
      fontStr = String(v);
      ops.push({ name: "font", args: [fontStr] });
    },
    enumerable: true,
    configurable: true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ops };
}

const PAINT_OPS = ["fill", "stroke", "fillRect", "strokeRect"];

/** Sub-path persegi bulat yang dihasilkan roundedRectPath (moveTo + 4 arcTo + closePath). */
function roundedRectPathOps(x: number, y: number, w: number, h: number, r: number): Op[] {
  return [
    { name: "moveTo", args: [x + r, y] },
    { name: "arcTo", args: [x + w, y, x + w, y + h, r] },
    { name: "arcTo", args: [x + w, y + h, x, y + h, r] },
    { name: "arcTo", args: [x, y + h, x, y, r] },
    { name: "arcTo", args: [x, y, x + w, y, r] },
    { name: "closePath", args: [] },
  ];
}

/** Blok path yang ditutup fill("evenodd") — dari beginPath sampai fill. */
function evenoddBlocks(ops: Op[]): Op[][] {
  const blocks: Op[][] = [];
  let start = -1;
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    if (o.name === "beginPath") start = i;
    else if (o.name === "fill" && o.args[0] === "evenodd" && start >= 0) {
      blocks.push(ops.slice(start, i + 1));
      start = -1;
    }
  }
  return blocks;
}

/** Sub-path dalam blok: urutan moveTo → … → closePath. */
function subPaths(block: Op[]): Op[][] {
  const paths: Op[][] = [];
  let cur: Op[] = [];
  for (const o of block) {
    if (o.name === "moveTo") {
      if (cur.length) paths.push(cur);
      cur = [o];
    } else if (o.name === "closePath") {
      cur.push(o);
      paths.push(cur);
      cur = [];
    } else cur.push(o);
  }
  if (cur.length) paths.push(cur);
  return paths;
}

/** Sub-path persegi bulat (moveTo + 4 arcTo + closePath) dalam blok. */
function roundedSubPaths(block: Op[]): Op[][] {
  return subPaths(block).filter(
    (p) => p.length === 6 && p.filter((o) => o.name === "arcTo").length === 4
  );
}

const CATEGORIES = ["Klasik", "Polaroid", "Vintage", "Festif", "Modern", "Booth"] as const;

/** Ukuran nyata: 3×4 @300dpi, 2×3 @300dpi, demo FramePicker, dan kecil ekstrem. */
const SIZES: Array<[number, number]> = [
  [354, 472],
  [236, 354],
  [108, 144],
  [21, 30],
];

describe("FRAMES — semua bingkai menggambar tanpa throw", () => {
  it("katalog lengkap: 60 bingkai dalam 6 kategori", () => {
    expect(FRAMES.length).toBe(60);
    expect([...new Set(FRAMES.map((f) => f.category))].sort()).toEqual([
      ...CATEGORIES,
    ].sort());
  });

  // Smoke test terpisah per kategori: tiap frame menggambar tanpa throw di
  // semua ukuran dan benar-benar melukis.
  for (const cat of CATEGORIES) {
    it(`kategori ${cat}: semua frame menggambar tanpa throw & melukis (4 ukuran)`, () => {
      const frames = FRAMES.filter((f) => f.category === cat);
      expect(frames.length, `${cat} punya frame`).toBeGreaterThan(0);
      for (const f of frames) {
        for (const [w, h] of SIZES) {
          const { ctx, ops } = makeCtx();
          expect(() => f.draw(ctx, w, h), `${f.id} @ ${w}×${h}`).not.toThrow();
          expect(
            ops.some((o) => PAINT_OPS.includes(o.name)),
            `${f.id} @ ${w}×${h} menghasilkan lukisan`
          ).toBe(true);
        }
      }
    });
  }
});

describe("cincin rounded per kategori — roundedBorder radius sama di kedua sisi", () => {
  /** Pemakai roundedBorder tiap kategori (regresi lubang dalam kotak). */
  const ROUNDED_CONSUMERS: Record<string, string[]> = {
    Vintage: ["vintage-bulat", "vintage-foto-lama"],
    Modern: ["modern-radius", "modern-dobel-radius", "modern-sudut-hitam"],
  };
  const SIZES_CHECK: Array<[number, number]> = [
    [354, 472],
    [108, 144],
  ];

  it("hanya kategori Vintage & Modern yang memakai roundedBorder", () => {
    const users = new Set(
      FRAMES.filter((f) =>
        Object.values(ROUNDED_CONSUMERS).flat().includes(f.id)
      ).map((f) => f.category)
    );
    expect(users).toEqual(new Set(["Vintage", "Modern"]));
  });

  for (const [cat, ids] of Object.entries(ROUNDED_CONSUMERS)) {
    it(`kategori ${cat}: tiap pemakai roundedBorder punya cincin radius sama di kedua sisi`, () => {
      for (const id of ids) {
        const frame = getFrame(id);
        expect(frame, `${id} terdaftar`).toBeDefined();
        for (const [w, h] of SIZES_CHECK) {
          const { ctx, ops } = makeCtx();
          frame!.draw(ctx, w, h);
          const blocks = evenoddBlocks(ops);
          expect(blocks.length, `${id}: minimal satu cincin evenodd`).toBeGreaterThan(0);
          for (const block of blocks) {
            const paths = roundedSubPaths(block);
            expect(paths.length, `${id}: cincin = 2 persegi bulat`).toBe(2);
            // Regresi lubang dalam kotak: SEMUA arcTo memakai radius yang sama
            // di kedua sisi (tepi luar & lubang dalam persegi bulat radius r).
            const radii = paths.flatMap((p) =>
              p.filter((o) => o.name === "arcTo").map((o) => o.args[4] as number)
            );
            expect(radii).toHaveLength(8);
            for (const r of radii) expect(r).toBe(radii[0]);
            // Lubang dalam dimulai lebih dalam dari tepi luar (inset positif).
            const outerX = paths[0][0].args[0] as number;
            const innerX = paths[1][0].args[0] as number;
            expect(innerX).toBeGreaterThan(outerX);
          }
        }
      }
    });
  }
});

describe("validFrameId — normalisasi id bingkai (pertahanan lapisan kedua FramePicker)", () => {
  it("mengembalikan id yang ada di katalog apa adanya", () => {
    expect(validFrameId("modern-radius")).toBe("modern-radius");
  });

  it("mengembalikan \"\" (Tanpa bingkai) untuk id yang tidak dikenal", () => {
    expect(validFrameId("bingkai-hantu-tidak-ada")).toBe("");
  });

  it("mengembalikan \"\" untuk string kosong (tanpa bingkai tetap tanpa bingkai)", () => {
    expect(validFrameId("")).toBe("");
  });

  it("konsisten dengan katalog: semua id katalog valid, id non-katalog tidak", () => {
    for (const f of FRAMES) expect(validFrameId(f.id)).toBe(f.id);
    expect(validFrameId("modern-radius-v2")).toBe("");
    expect(validFrameId("Polaroid")).toBe("");
  });
});

describe("modern-radius — pita bayangan mengikuti radius sudut", () => {
  const W = 354;
  const H = 472;
  // Formula identik dengan frames.ts: th=tp(m,5), r=round(m*0.08), i2=th*1.6.
  const m = Math.min(W, H);
  const th = Math.max(1, Math.round((m * 5) / 100)); // 18
  const r = Math.max(1, Math.round(m * 0.08)); // 28
  const i2 = th * 1.6; // 28.8

  function shadowBlock(): Op[] {
    const { ctx, ops } = makeCtx();
    const frame = getFrame("modern-radius");
    expect(frame).toBeDefined();
    frame!.draw(ctx, W, H);

    const styleIdx = ops.findIndex(
      (o) => o.name === "fillStyle" && o.args[0] === "rgba(0,0,0,0.18)"
    );
    expect(styleIdx, "bayangan punya fillStyle sendiri").toBeGreaterThanOrEqual(0);
    const fillIdx = ops.findIndex(
      (o, i) => i > styleIdx && o.name === "fill" && o.args[0] === "evenodd"
    );
    expect(fillIdx, "bayangan ditutup dengan fill(evenodd)").toBeGreaterThan(0);
    return ops.slice(styleIdx + 1, fillIdx + 1);
  }

  it("bayangan adalah cincin rounded: dua persegi bulat radius SAMA, evenodd", () => {
    const block = shadowBlock();
    expect(block).toEqual([
      { name: "beginPath", args: [] },
      ...roundedRectPathOps(0, 0, W, H, r), // tepi luar
      ...roundedRectPathOps(i2, i2, W - i2 * 2, H - i2 * 2, r), // lubang dalam, radius sama
      { name: "fill", args: ["evenodd"] },
    ]);
  });

  it("band mengikuti sudut: pusat busur dalam digeser (i2,i2) dari luar → lebar diagonal i2√2", () => {
    const block = shadowBlock();
    const arcs = block.filter((o) => o.name === "arcTo");
    expect(arcs).toHaveLength(8); // 4 sudut × 2 persegi bulat
    // Semua arcTo memakai radius yang sama persis (r) — kelengkungan seragam.
    for (const a of arcs) expect(a.args[4]).toBe(r);

    // Pusat busur sudut: persegi bulat (x,y,w,h,r) → pusat sudut (x+r, y+r).
    const outerCenter = [r, r];
    const innerCenter = [i2 + r, i2 + r];
    const offsetX = innerCenter[0] - outerCenter[0];
    const offsetY = innerCenter[1] - outerCenter[1];
    expect(offsetX).toBeCloseTo(i2, 5);
    expect(offsetY).toBeCloseTo(i2, 5);
    // Lebar pita sepanjang diagonal = |pergeseran pusat| (dua busur berjari-jari sama).
    const bandDiagonal = Math.hypot(offsetX, offsetY);
    expect(bandDiagonal).toBeCloseTo(i2 * Math.SQRT2, 5);
    expect(bandDiagonal).toBeGreaterThan(th); // pita nyata, bukan nol
  });

  it("bayangan digambar SEBELUM bingkai putih; bingkai putih juga berlubang rounded radius sama", () => {
    const { ctx, ops } = makeCtx();
    getFrame("modern-radius")!.draw(ctx, W, H);

    const styleOrder = ops
      .filter((o) => o.name === "fillStyle")
      .map((o) => o.args[0]);
    expect(styleOrder).toContain("rgba(0,0,0,0.18)");
    expect(styleOrder).toContain("#ffffff");
    expect(styleOrder.indexOf("rgba(0,0,0,0.18)")).toBeLessThan(
      styleOrder.indexOf("#ffffff")
    );

    // Blok bingkai putih = roundedBorder: dua persegi bulat radius r, lubang dalam
    // di (th, th) — sudut dalam bingkai tidak kotak (regresi perbaikan inner hole).
    const whiteIdx = ops.findIndex(
      (o) => o.name === "fillStyle" && o.args[0] === "#ffffff"
    );
    expect(whiteIdx).toBeGreaterThanOrEqual(0);
    const beginIdx = ops.findIndex((o, i) => i > whiteIdx && o.name === "beginPath");
    const fillIdx = ops.findIndex(
      (o, i) => i > beginIdx && o.name === "fill" && o.args[0] === "evenodd"
    );
    expect(ops.slice(beginIdx, fillIdx + 1)).toEqual([
      { name: "beginPath", args: [] },
      ...roundedRectPathOps(0, 0, W, H, r),
      ...roundedRectPathOps(th, th, W - th * 2, H - th * 2, r),
      { name: "fill", args: ["evenodd"] },
    ]);
  });
});

describe("Booth — elemen signature template photo booth (revisi referensi)", () => {
  it("kategori Booth punya minimal 10 bingkai baru", () => {
    const booth = FRAMES.filter((f) => f.category === "Booth");
    expect(booth.length).toBeGreaterThanOrEqual(10);
  });

  it("bingkai bertulisan (banner/hashtag/stempel) memakai fillText", () => {
    const textIds = [
      "booth-banner",
      "booth-hashtag",
      "booth-hashtag-warna",
      "booth-stempel",
    ];
    for (const id of textIds) {
      const frame = getFrame(id);
      expect(frame, `${id} terdaftar`).toBeDefined();
      const { ctx, ops } = makeCtx();
      frame!.draw(ctx, 236, 354);
      expect(
        ops.filter((o) => o.name === "fillText").length,
        `${id} menggambar teks`
      ).toBeGreaterThan(0);
    }
  });

  it("booth-bunting menggambar tali + 10 segitiga bendera", () => {
    const { ctx, ops } = makeCtx();
    getFrame("booth-bunting")!.draw(ctx, 236, 354);
    // 10 segitiga (masing-masing 2 lineTo + closePath) + 1 tali
    const lineTo = ops.filter((o) => o.name === "lineTo");
    expect(lineTo.length).toBeGreaterThanOrEqual(21);
    expect(ops.filter((o) => o.name === "fill").length).toBeGreaterThanOrEqual(10);
  });

  it("booth-stempel memakai transformasi rotasi + garis putus-putus", () => {
    const { ctx, ops } = makeCtx();
    getFrame("booth-stempel")!.draw(ctx, 236, 354);
    expect(ops.some((o) => o.name === "rotate")).toBe(true);
    expect(ops.some((o) => o.name === "setLineDash")).toBe(true);
  });

  it("booth-stripes ter-clip ke keempat band (rect + clip + save/restore)", () => {
    const { ctx, ops } = makeCtx();
    getFrame("booth-stripes")!.draw(ctx, 236, 354);
    expect(ops.filter((o) => o.name === "rect").length).toBe(4);
    expect(ops.some((o) => o.name === "clip")).toBe(true);
  });
});

describe("Booth — teks bingkai bisa dikustomisasi (hashtag & banner)", () => {
  /** Teks yang digambar lewat fillText pada frame. */
  const drawnTexts = (id: string, opts?: { hashtagText?: string; bannerText?: string }) => {
    const frame = getFrame(id);
    expect(frame, `${id} terdaftar`).toBeDefined();
    const { ctx, ops } = makeCtx();
    frame!.draw(ctx, 236, 354, opts);
    return ops.filter((o) => o.name === "fillText").map((o) => o.args[0]);
  };

  it("default: hashtag #SENYUM, banner PHOTO BOOTH (tanpa opts)", () => {
    expect(drawnTexts("booth-hashtag")).toContain("#SENYUM");
    expect(drawnTexts("booth-hashtag-warna")).toContain("#SENYUM");
    expect(drawnTexts("booth-banner")).toContain("PHOTO BOOTH");
  });

  it("hashtag kustom menggantikan default di booth-hashtag & booth-hashtag-warna", () => {
    expect(drawnTexts("booth-hashtag", { hashtagText: "#ADITAA" })).toContain("#ADITAA");
    expect(drawnTexts("booth-hashtag", { hashtagText: "#ADITAA" })).not.toContain("#SENYUM");
    expect(drawnTexts("booth-hashtag-warna", { hashtagText: "#LESTARI" })).toContain("#LESTARI");
  });

  it("banner kustom menggantikan PHOTO BOOTH di booth-banner", () => {
    expect(drawnTexts("booth-banner", { bannerText: "FESTIVAL 2026" })).toContain("FESTIVAL 2026");
    expect(drawnTexts("booth-banner", { bannerText: "FESTIVAL 2026" })).not.toContain("PHOTO BOOTH");
  });

  it("hashtag kosong jatuh kembali ke default #SENYUM (bukan teks kosong)", () => {
    expect(drawnTexts("booth-hashtag", { hashtagText: "" })).toContain("#SENYUM");
  });

  it("frame non-Booth tetap menggambar tanpa opts (signature draw kompatibel)", () => {
    const { ctx, ops } = makeCtx();
    getFrame("modern-radius")!.draw(ctx, 236, 354, { hashtagText: "#X" });
    expect(
      ops.some((o) => PAINT_OPS.includes(o.name))
    ).toBe(true);
  });
});

describe("Booth — font mengecil otomatis saat teks melebihi lebar band", () => {
  const pxOf = (font: string) => {
    const m = /bold ([\d.]+)px/.exec(font);
    return m ? parseFloat(m[1]) : 0;
  };
  const drawAt = (id: string, opts?: { hashtagText?: string; bannerText?: string }) => {
    const frame = getFrame(id)!;
    const { ctx, ops } = makeCtx();
    frame.draw(ctx, 236, 354, opts);
    const fonts = ops
      .filter((o) => o.name === "font")
      .map((o) => String(o.args[0]));
    return {
      finalPx: pxOf(fonts[fonts.length - 1] ?? ""),
      measureCalls: ops.filter((o) => o.name === "measureText").length,
    };
  };

  it("teks pendek tidak mengecil (ukur sekali, font dasar dipertahankan)", () => {
    // fs dasar booth-hashtag di 236×354 = max(3, 236*0.09) = 21.24 px
    const { finalPx, measureCalls } = drawAt("booth-hashtag", {
      hashtagText: "#SENYUM",
    });
    expect(finalPx).toBeCloseTo(21.24, 2);
    expect(measureCalls).toBe(1);
  });

  it("hashtag panjang mengecilkan font sampai muat (floor = 50% ukuran dasar)", () => {
    const { finalPx, measureCalls } = drawAt("booth-hashtag", {
      hashtagText: "#TAMU-" + "X".repeat(30),
    });
    expect(measureCalls).toBeGreaterThan(1);
    expect(finalPx).toBeLessThan(21.24);
    expect(finalPx).toBeGreaterThanOrEqual(10.62 - 0.001);
  });

  it("banner panjang juga mengecil", () => {
    // fs dasar booth-banner = max(3, 236*0.085) = 20.06 px
    const { finalPx } = drawAt("booth-banner", {
      bannerText: "SELAMAT DATANG DI ACARA PERNIKAHAN AGUNG",
    });
    expect(finalPx).toBeLessThan(20.06);
  });

  it("booth-hashtag-warna memakai shrink juga", () => {
    const { finalPx } = drawAt("booth-hashtag-warna", {
      hashtagText: "#" + "PANJANG".repeat(6),
    });
    // fs dasar = max(3, 236*0.085) = 20.06; teks panjang harus mengecil
    expect(finalPx).toBeLessThan(20.06);
  });
});

describe("coverFitRect — object-fit:cover (sumber tunggal applyFrame & worker)", () => {
  it("foto lebih lebar dari kanvas: mengisi tinggi, memotong lebar (dx negatif)", () => {
    // sumber 4:3 (4000×3000) ke kanvas 3:4 (354×472): cover = skala tinggi
    const r = coverFitRect(4000, 3000, 354, 472);
    expect(r.dh).toBe(472);
    expect(r.dy).toBe(0);
    expect(r.dw).toBeCloseTo((4000 * 472) / 3000); // = 629.33
    expect(r.dx).toBeCloseTo((354 - r.dw) / 2, 5); // negatif (terpotong)
    // cover: tidak ada pita kosong di kedua arah
    expect(r.dw).toBeGreaterThanOrEqual(354);
    expect(r.dh).toBeGreaterThanOrEqual(472);
  });

  it("foto lebih tinggi dari kanvas: mengisi lebar, memotong tinggi (dy negatif)", () => {
    // sumber 3:4 (3000×4000) ke kanvas 4:3 (472×354): cover = skala lebar
    const r = coverFitRect(3000, 4000, 472, 354);
    expect(r.dw).toBe(472);
    expect(r.dx).toBe(0);
    expect(r.dh).toBeCloseTo((4000 * 472) / 3000); // = 629.33
    expect(r.dy).toBeCloseTo((354 - r.dh) / 2, 5); // negatif
    expect(r.dw).toBeGreaterThanOrEqual(472);
    expect(r.dh).toBeGreaterThanOrEqual(354);
  });

  it("rasio sama → tidak ada pemotongan (dx = dy = 0)", () => {
    // 3000×4000 dan 354×472 sama-sama 3:4
    const r = coverFitRect(3000, 4000, 354, 472);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.dw).toBe(354);
    expect(r.dh).toBe(472);
  });

  it("terpusat: offset simetris pada sumbu yang terpotong", () => {
    // sumber lebih lebar → tinggi terisi penuh, lebar terpotong simetris
    const r = coverFitRect(4000, 3000, 354, 472);
    expect(r.dh).toBe(472);
    expect(r.dy).toBe(0);
    expect(r.dw).toBeGreaterThan(354);
    expect(r.dx).toBeCloseTo(-(r.dw - 354) / 2, 5);
  });

  it("identik dengan matematika manual applyFrame (paritas piksel)", () => {
    const srcW = 3000;
    const srcH = 2000;
    const dstW = 236;
    const dstH = 354;
    const s = Math.max(dstW / srcW, dstH / srcH);
    const dw = srcW * s;
    const dh = srcH * s;
    const manual = { dx: (dstW - dw) / 2, dy: (dstH - dh) / 2, dw, dh };
    expect(coverFitRect(srcW, srcH, dstW, dstH)).toEqual(manual);
  });
});

describe("modern-sudut-hitam — lubang dalam rounded radius sama (pola roundedBorder)", () => {
  const W = 354;
  const H = 472;
  // Formula identik dengan frames.ts: th=tp(m,7), r=round(m*0.22).
  const m = Math.min(W, H);
  const th = Math.max(1, Math.round((m * 7) / 100)); // 25
  const r = Math.max(1, Math.round(m * 0.22)); // 78

  it("cincin hitam pakai dua persegi bulat radius SAMA (evenodd), bukan lubang kotak", () => {
    const { ctx, ops } = makeCtx();
    getFrame("modern-sudut-hitam")!.draw(ctx, W, H);

    const blackIdx = ops.findIndex(
      (o) => o.name === "fillStyle" && o.args[0] === "#111111"
    );
    expect(blackIdx).toBeGreaterThanOrEqual(0);
    const beginIdx = ops.findIndex((o, i) => i > blackIdx && o.name === "beginPath");
    const fillIdx = ops.findIndex(
      (o, i) => i > beginIdx && o.name === "fill" && o.args[0] === "evenodd"
    );
    expect(ops.slice(beginIdx, fillIdx + 1)).toEqual([
      { name: "beginPath", args: [] },
      ...roundedRectPathOps(0, 0, W, H, r),
      ...roundedRectPathOps(th, th, W - th * 2, H - th * 2, r),
      { name: "fill", args: ["evenodd"] },
    ]);
  });

  it("radius konsisten: semua arcTo cincin memakai r yang sama (kelengkungan seragam)", () => {
    const { ctx, ops } = makeCtx();
    getFrame("modern-sudut-hitam")!.draw(ctx, W, H);
    const arcs = ops.filter((o) => o.name === "arcTo");
    expect(arcs).toHaveLength(8); // 4 sudut × 2 persegi bulat
    for (const a of arcs) expect(a.args[4]).toBe(r);
  });
});
