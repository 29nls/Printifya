/**
 * Katalog bingkai foto bergaya photobox/fotobox — 60 bingkai prosedural yang
 * digambar langsung di canvas (tanpa aset eksternal), terinspirasi konvensi
 * frame foto booth: bingkai klasik, polaroid dengan area caption, gaya
 * vintage (scallop, renda, paku sudut), tema festif (hati, bintang, balon,
 * pernikahan, natal, lebaran, gradasi, confetti), gaya modern (minimal,
 * offset, radius + bayangan, film strip, kurung sudut), dan gaya booth yang
 * meniru elemen signature template photo booth populer (bunting, strip
 * hashtag, banner "PHOTO BOOTH", washi tape, polka dots, garis pelangi,
 * stempel tanggal, viewfinder kamera).
 *
 * Tiap bingkai adalah fungsi `draw(ctx, w, h, opts?)` yang melukis OVERLAY di
 * atas foto yang sudah digambar full-canvas. Ketebalan proporsional terhadap
 * sisi terpendek agar konsisten di semua ukuran pas foto. Bingkai bertulisan
 * Booth (hashtag & banner) menerima teks kustom lewat `opts`
 * (hashtagText/bannerText) — dipakai Auto Layout untuk kustomisasi per event.
 */

/** Opsi gambar bingkai — teks kustom untuk bingkai bertulisan Booth. */
export interface FrameDrawOptions {
  /** Teks strip hashtag (booth-hashtag, booth-hashtag-warna); default "#SENYUM". */
  hashtagText?: string;
  /** Teks banner (booth-banner); default "PHOTO BOOTH". */
  bannerText?: string;
}

export interface PhotoFrame {
  id: string;
  name: string;
  category: string;
  draw: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    opts?: FrameDrawOptions
  ) => void;
}

type Ctx = CanvasRenderingContext2D;

/* ---------- Helper gambar ---------- */

const round = (x: number) => Math.max(1, Math.round(x));
/** Ketebalan dari persen sisi terpendek. */
const tp = (m: number, p: number) => round((m * p) / 100);

/** PRNG deterministik (mulberry32) — confetti/dots konsisten tiap render. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PALETTE = [
  "#e63946", "#f4a261", "#e9c46a", "#2a9d8f",
  "#457b9d", "#9b5de5", "#f15bb5", "#00bbf9",
];

/** Bingkai solid: 4 sisi tebal `th`, warna `color`, mulai dari inset. */
function border(
  ctx: Ctx,
  w: number,
  h: number,
  th: number,
  color: string | CanvasGradient,
  inset = 0
): void {
  ctx.fillStyle = color;
  ctx.fillRect(inset, inset, w - inset * 2, th);
  ctx.fillRect(inset, h - inset - th, w - inset * 2, th);
  ctx.fillRect(inset, inset, th, h - inset * 2);
  ctx.fillRect(w - inset - th, inset, th, h - inset * 2);
}

/** Bingkai rounded (sudut membulat radius `r`) via evenodd: tepi luar DAN
 *  lubang dalam sama-sama persegi bulat radius r — sudut dalam bingkai tidak
 *  lagi kotak (sebelumnya lubang memakai rect bersudut tajam). */
function roundedBorder(
  ctx: Ctx,
  w: number,
  h: number,
  th: number,
  color: string,
  r: number
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  roundedRectPath(ctx, 0, 0, w, h, r);
  roundedRectPath(ctx, th, th, w - th * 2, h - th * 2, r);
  ctx.fill("evenodd");
}

/** Path persegi bulat dari (x, y) berukuran (w, h) dengan radius sudut r. */
function roundedRectPath(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Garis bentuk hati (sumbu y ke bawah). */
function heartPath(ctx: Ctx, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.35);
  ctx.bezierCurveTo(cx - s, cy - s * 0.25, cx - s * 0.55, cy - s, cx, cy - s * 0.4);
  ctx.bezierCurveTo(cx + s * 0.55, cy - s, cx + s, cy - s * 0.25, cx, cy + s * 0.35);
  ctx.closePath();
}

/** Garis bentuk bintang 5 ujung. */
function starPath(
  ctx: Ctx,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Tepi scallop: garis putih dengan batas dalam bergelombang (vintage). */
function scallop(
  ctx: Ctx,
  w: number,
  h: number,
  th: number,
  color: string,
  step: number,
  amp: number
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.moveTo(0, th);
  const inner = (
    x: number,
    y: number,
    nx: number,
    ny: number,
    along: "x" | "y"
  ) => {
    ctx.lineTo(x, y);
    ctx.quadraticCurveTo(
      nx,
      ny,
      along === "x" ? x + step : x,
      along === "x" ? y : y + step
    );
  };
  // atas (kiri → kanan)
  for (let x = 0; x <= w; x += step) {
    inner(x, th, x + step / 2, th - amp, "x");
  }
  // kanan
  for (let y = 0; y <= h; y += step) {
    inner(w - th, y, w - th + amp, y + step / 2, "y");
  }
  // bawah (kanan → kiri)
  for (let x = w; x >= 0; x -= step) {
    inner(x, h - th, x - step / 2, h - th + amp, "x");
  }
  // kiri
  for (let y = h; y >= 0; y -= step) {
    inner(th, y, th - amp, y - step / 2, "y");
  }
  ctx.fill("evenodd");
}

/** Polaroid: bingkai tebal + band caption di bawah. */
function polaroid(
  ctx: Ctx,
  w: number,
  h: number,
  th: number,
  bandColor: string,
  bandPct: number
): void {
  border(ctx, w, h, th, "#ffffff");
  ctx.fillStyle = bandColor;
  ctx.fillRect(0, h - (h * bandPct) / 100, w, (h * bandPct) / 100);
}

/** Film strip: band hitam atas & bawah dengan lubang sproket. */
function filmStrip(ctx: Ctx, w: number, h: number, bandPct: number): void {
  const bh = (h * bandPct) / 100;
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, w, bh);
  ctx.fillRect(0, h - bh, w, bh);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  const holeW = Math.max(2, w / 24);
  const gap = w / 24;
  for (let i = 0; i < 24; i++) {
    const x = i * gap + (gap - holeW) / 2;
    const hy = bh * 0.28;
    ctx.fillRect(x, hy, holeW, bh * 0.44);
    ctx.fillRect(x, h - bh + hy, holeW, bh * 0.44);
  }
}

/**
 * Teks terpusat dengan ukuran font proporsional (elemen template booth).
 * Bila `maxWidth` diberikan dan teks lebih lebar dari itu, ukuran font
 * diturunkan otomatis (minimal setengah ukuran dasar) agar teks kustom
 * panjang tidak terpotong di band sempit / sel pas foto kecil.
 */
function centeredText(
  ctx: Ctx,
  text: string,
  cx: number,
  cy: number,
  fs: number,
  color: string,
  maxWidth?: number
): void {
  ctx.fillStyle = color;
  let size = fs;
  const apply = (s: number) => {
    ctx.font = `bold ${s}px Arial, sans-serif`;
  };
  apply(size);
  if (maxWidth && maxWidth > 0) {
    // Ukuran minimum: setengah ukuran dasar (tidak lebih kecil dari 3 px)
    // agar teks tetap terbaca meski sangat panjang.
    const floor = Math.max(3, fs * 0.5);
    while (size > floor && ctx.measureText(text).width > maxWidth) {
      // Clamp ke floor agar langkah terakhir tidak jatuh di bawah minimum.
      size = Math.max(floor, size - 1);
      apply(size);
    }
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
}

/* ===================================================================== *
 *  KATALOG 60 BINGKAI
 * ===================================================================== */

export const FRAMES: PhotoFrame[] = [
  /* ---------- Klasik (12) ---------- */
  { id: "klasik-putih-tipis", name: "Putih Tipis", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 2), "#ffffff") },
  { id: "klasik-putih-tebal", name: "Putih Tebal", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 8), "#ffffff") },
  { id: "klasik-hitam-tipis", name: "Hitam Tipis", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 2), "#111111") },
  { id: "klasik-hitam-tebal", name: "Hitam Tebal", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 8), "#111111") },
  { id: "klasik-abu", name: "Abu-abu", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 5), "#8b8b8b") },
  { id: "klasik-dobel-putih-hitam", name: "Dobel Putih-Hitam", category: "Klasik", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 3), "#111111"); border(c, w, h, tp(m, 6), "#ffffff", tp(m, 3)); } },
  { id: "klasik-dobel-hitam-putih", name: "Dobel Hitam-Putih", category: "Klasik", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 3), "#ffffff"); border(c, w, h, tp(m, 6), "#111111", tp(m, 3)); } },
  { id: "klasik-dobel-emas", name: "Dobel Emas-Putih", category: "Klasik", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 2.5), "#c9a227"); border(c, w, h, tp(m, 6), "#ffffff", tp(m, 2.5)); } },
  { id: "klasik-krem", name: "Krem", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 6), "#f3ead9") },
  { id: "klasik-navy", name: "Navy", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 6), "#1d3557") },
  { id: "klasik-maroon", name: "Maroon", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 6), "#6d1a1a") },
  { id: "klasik-emas-tipis", name: "Emas Tipis", category: "Klasik", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 2.5), "#c9a227") },

  /* ---------- Polaroid (8) ---------- */
  { id: "polaroid-klasik", name: "Polaroid Klasik", category: "Polaroid", draw: (c, w, h) => polaroid(c, w, h, tp(Math.min(w, h), 7), "#ffffff", 20) },
  { id: "polaroid-hitam", name: "Polaroid Hitam", category: "Polaroid", draw: (c, w, h) => { border(c, w, h, tp(Math.min(w, h), 7), "#222222"); const bh = (h * 20) / 100; c.fillStyle = "#222222"; c.fillRect(0, h - bh, w, bh); } },
  { id: "polaroid-emas", name: "Polaroid Emas", category: "Polaroid", draw: (c, w, h) => { border(c, w, h, tp(Math.min(w, h), 6), "#ffffff"); const bh = (h * 20) / 100; c.fillStyle = "#c9a227"; c.fillRect(0, h - bh, w, bh); } },
  { id: "polaroid-biru", name: "Polaroid Biru", category: "Polaroid", draw: (c, w, h) => { border(c, w, h, tp(Math.min(w, h), 6), "#ffffff"); const bh = (h * 20) / 100; c.fillStyle = "#3a6ea5"; c.fillRect(0, h - bh, w, bh); } },
  { id: "polaroid-pink", name: "Polaroid Pink", category: "Polaroid", draw: (c, w, h) => { border(c, w, h, tp(Math.min(w, h), 6), "#ffffff"); const bh = (h * 20) / 100; c.fillStyle = "#e8a2b8"; c.fillRect(0, h - bh, w, bh); } },
  { id: "polaroid-dobel", name: "Polaroid Dobel", category: "Polaroid", draw: (c, w, h) => { const m = Math.min(w, h); polaroid(c, w, h, tp(m, 6), "#ffffff", 20); border(c, w, h, 1, "#d8d8d8", tp(m, 3)); } },
  { id: "polaroid-mini", name: "Polaroid Mini", category: "Polaroid", draw: (c, w, h) => polaroid(c, w, h, tp(Math.min(w, h), 3), "#ffffff", 12) },
  { id: "polaroid-krem", name: "Polaroid Krem", category: "Polaroid", draw: (c, w, h) => { border(c, w, h, tp(Math.min(w, h), 6), "#f3ead9"); const bh = (h * 20) / 100; c.fillStyle = "#f3ead9"; c.fillRect(0, h - bh, w, bh); } },

  /* ---------- Vintage (8) ---------- */
  { id: "vintage-bulat", name: "Sudut Bulat", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); roundedBorder(c, w, h, tp(m, 6), "#ffffff", round(m * 0.18)); } },
  { id: "vintage-foto-lama", name: "Foto Lama", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); const r = round(m * 0.16); roundedBorder(c, w, h, tp(m, 6), "#f3ead9", r); c.strokeStyle = "#8a6f3d"; c.lineWidth = 1; c.beginPath(); c.moveTo(r + tp(m, 6), tp(m, 6)); c.arcTo(w - tp(m, 6), tp(m, 6), w - tp(m, 6), h - tp(m, 6), r); c.arcTo(w - tp(m, 6), h - tp(m, 6), tp(m, 6), h - tp(m, 6), r); c.arcTo(tp(m, 6), h - tp(m, 6), tp(m, 6), tp(m, 6), r); c.arcTo(tp(m, 6), tp(m, 6), w - tp(m, 6), tp(m, 6), r); c.stroke(); } },
  { id: "vintage-scallop", name: "Scallop", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); scallop(c, w, h, tp(m, 6), "#ffffff", round(m * 0.14), round(m * 0.035)); } },
  { id: "vintage-renda", name: "Renda", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 5), "#ffffff"); c.fillStyle = "#b9a88c"; c.strokeStyle = "#b9a88c"; c.lineWidth = 1; const n = 10; for (let i = 0; i <= n; i++) { const p = i / n; const x = p * w; const y = p * h; c.beginPath(); c.arc(x, tp(m, 5) / 2, Math.max(1, m * 0.008), 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(x, h - tp(m, 5) / 2, Math.max(1, m * 0.008), 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(tp(m, 5) / 2, y, Math.max(1, m * 0.008), 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(w - tp(m, 5) / 2, y, Math.max(1, m * 0.008), 0, Math.PI * 2); c.fill(); } } },
  { id: "vintage-paku", name: "Paku Sudut", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); const th = tp(m, 2.5); border(c, w, h, th, "#ffffff"); c.fillStyle = "#6b4f2a"; const r = Math.max(2, m * 0.02); const o = th / 2; [[o, o], [w - o, o], [o, h - o], [w - o, h - o]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }); } },
  { id: "vintage-garis-lengkung", name: "Garis Lengkung", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 4), "#ffffff"); c.strokeStyle = "#d9c9a8"; c.lineWidth = Math.max(1, m * 0.012); const o = tp(m, 7); c.strokeRect(o, o, w - o * 2, h - o * 2); } },
  { id: "vintage-bintang-sudut", name: "Bintang Sudut", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); const th = tp(m, 3); border(c, w, h, th, "#ffffff"); c.fillStyle = "#c9a227"; const o = th * 2; const s = Math.max(3, m * 0.05); [[o, o], [w - o, o], [o, h - o], [w - o, h - o]].forEach(([x, y]) => { starPath(c, x, y, s, s * 0.45); c.fill(); }); } },
  { id: "vintage-hati-sudut", name: "Hati Sudut", category: "Vintage", draw: (c, w, h) => { const m = Math.min(w, h); const th = tp(m, 3); border(c, w, h, th, "#ffffff"); c.fillStyle = "#d64550"; const o = th * 2.2; const s = Math.max(3, m * 0.05); [[o, o], [w - o, o], [o, h - o], [w - o, h - o]].forEach(([x, y]) => { heartPath(c, x, y, s); c.fill(); }); } },

  /* ---------- Festif (10) ---------- */
  { id: "festif-hati-putih", name: "Hati Putih", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 4), "#ffffff"); c.fillStyle = "#ffffff"; heartPath(c, w / 2, tp(m, 4), Math.max(2, m * 0.04)); c.fill(); heartPath(c, w / 2, h - tp(m, 4), Math.max(2, m * 0.04)); c.fill(); } },
  { id: "festif-hati-merah", name: "Hati Merah", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 4), "#d64550"); c.fillStyle = "#ffffff"; const o = tp(m, 4) * 2; const s = Math.max(2, m * 0.035); [[o, o], [w - o, o], [o, h - o], [w - o, h - o]].forEach(([x, y]) => { heartPath(c, x, y, s); c.fill(); }); } },
  { id: "festif-bintang", name: "Bintang Emas", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 4), "#c9a227"); c.fillStyle = "#f4d03f"; const o = tp(m, 4) * 2; const s = Math.max(2, m * 0.04); [[o, o], [w - o, o], [o, h - o], [w - o, h - o]].forEach(([x, y]) => { starPath(c, x, y, s, s * 0.45); c.fill(); }); } },
  { id: "festif-balon", name: "Balon", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 3), "#ffffff"); const rnd = seeded(11); for (let i = 0; i < 12; i++) { c.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)]; const p = (i + 0.5) / 12; const r = Math.max(1.5, m * 0.014); c.beginPath(); c.arc(p * w, tp(m, 3) / 2, r, 0, Math.PI * 2); c.fill(); c.beginPath(); c.arc(p * w, h - tp(m, 3) / 2, r, 0, Math.PI * 2); c.fill(); } } },
  { id: "festif-pernikahan", name: "Pernikahan", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 2.5), "#c9a227"); border(c, w, h, tp(m, 5), "#ffffff", tp(m, 2.5)); c.fillStyle = "#ffffff"; heartPath(c, w / 2, tp(m, 5), Math.max(2, m * 0.03)); c.fill(); } },
  { id: "festif-ulang-tahun", name: "Ulang Tahun", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 2.5), "#f15bb5"); border(c, w, h, tp(m, 5), "#ffffff", tp(m, 2.5)); const rnd = seeded(23); for (let i = 0; i < 26; i++) { c.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)]; const x = rnd() * w; const y = rnd() * h; const r = Math.max(1, m * 0.012) * (0.5 + rnd() * 1.4); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); } } },
  { id: "festif-natal", name: "Natal", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 3.5), "#b3261e"); border(c, w, h, tp(m, 3.5), "#2e7d32", tp(m, 3.5)); } },
  { id: "festif-lebaran", name: "Lebaran", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 3.5), "#0f5132"); border(c, w, h, tp(m, 3), "#c9a227", tp(m, 3.5)); } },
  { id: "festif-gradasi", name: "Gradasi", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, "#c9a227"); g.addColorStop(0.5, "#d64550"); g.addColorStop(1, "#c9a227"); border(c, w, h, tp(m, 5), g); } },
  { id: "festif-confetti", name: "Confetti", category: "Festif", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 4), "#ffffff"); const rnd = seeded(31); for (let i = 0; i < 40; i++) { c.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)]; const pos = rnd(); const edge = rnd(); const x = edge < 0.25 ? pos * w : edge < 0.5 ? pos * w : edge < 0.75 ? 0 : w; const y = edge < 0.25 ? 0 : edge < 0.5 ? h : pos * h; const r = Math.max(1, m * 0.01) * (0.4 + rnd()); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); } } },

  /* ---------- Modern (12) ---------- */
  { id: "modern-minimal", name: "Minimal", category: "Modern", draw: (c, w, h) => border(c, w, h, tp(Math.min(w, h), 1), "#bbbbbb") },
  { id: "modern-offset", name: "Offset", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); const thick = tp(m, 5); const thin = tp(m, 1.5); c.fillStyle = "#ffffff"; c.fillRect(0, 0, w, thick); c.fillRect(0, 0, thick, h); c.fillRect(0, h - thin, w, thin); c.fillRect(w - thin, 0, thin, h); } },
  { id: "modern-offset-dobel", name: "Offset Dobel", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 5), "#ffffff"); border(c, w, h, tp(m, 1.5), "#e5e5e5", tp(m, 2)); } },
  // Bayangan lembut mengikuti radius sudut yang sama: cincin rounded di dalam
  // bingkai putih (kanvas selebar kartu, jadi bayangan jatuh ke dalam).
  { id: "modern-radius", name: "Radius + Bayangan", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); const th = tp(m, 5); const r = round(m * 0.08); const i2 = th * 1.6; c.fillStyle = "rgba(0,0,0,0.18)"; c.beginPath(); roundedRectPath(c, 0, 0, w, h, r); roundedRectPath(c, i2, i2, w - i2 * 2, h - i2 * 2, r); c.fill("evenodd"); roundedBorder(c, w, h, th, "#ffffff", r); } },
  { id: "modern-kaca", name: "Kaca", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, tp(m, 2), "#ffffff"); const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, "rgba(255,255,255,0.35)"); g.addColorStop(0.45, "rgba(255,255,255,0.02)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,0.18)"); c.fillStyle = g; c.fillRect(0, 0, w, h); } },
  { id: "modern-garis-ganda", name: "Garis Ganda", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, 1, "#cccccc"); const o = tp(m, 3.5); c.strokeStyle = "#cccccc"; c.lineWidth = 1; c.strokeRect(o, o, w - o * 2, h - o * 2); } },
  { id: "modern-kurung", name: "Kurung Sudut", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); c.strokeStyle = "#555555"; c.lineWidth = Math.max(2, m * 0.02); const o = tp(m, 6); const L = Math.max(6, m * 0.12); c.beginPath(); c.moveTo(o, o + L); c.lineTo(o, o); c.lineTo(o + L, o); c.moveTo(w - o - L, o); c.lineTo(w - o, o); c.lineTo(w - o, o + L); c.moveTo(o, h - o - L); c.lineTo(o, h - o); c.lineTo(o + L, h - o); c.moveTo(w - o - L, h - o); c.lineTo(w - o, h - o); c.lineTo(w - o, h - o - L); c.stroke(); } },
  { id: "modern-tick", name: "Tick", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); border(c, w, h, 1, "#cccccc"); c.strokeStyle = "#cccccc"; c.lineWidth = 1; const n = 9; for (let i = 0; i <= n; i++) { const p = i / n; const x = p * w; const y = p * h; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, Math.max(2, m * 0.02)); c.stroke(); c.beginPath(); c.moveTo(x, h); c.lineTo(x, h - Math.max(2, m * 0.02)); c.stroke(); c.beginPath(); c.moveTo(0, y); c.lineTo(Math.max(2, m * 0.02), y); c.stroke(); c.beginPath(); c.moveTo(w, y); c.lineTo(w - Math.max(2, m * 0.02), y); c.stroke(); } } },
  { id: "modern-garis-bawah", name: "Garis Bawah", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); const th = Math.max(2, m * 0.03); c.fillStyle = "#c9a227"; c.fillRect(0, h - th, w, th); c.fillStyle = "#d64550"; const r = Math.max(2, m * 0.02); c.beginPath(); c.arc(w / 2, h - th / 2, r * 1.6, 0, Math.PI * 2); c.fill(); } },
  { id: "modern-dobel-radius", name: "Dobel Radius", category: "Modern", draw: (c, w, h) => { const m = Math.min(w, h); const th = tp(m, 5); const r = round(m * 0.1); roundedBorder(c, w, h, th, "#ffffff", r); c.strokeStyle = "#e0e0e0"; c.lineWidth = 1; const o = tp(m, 1); c.beginPath(); c.moveTo(r + th + o, th + o); c.arcTo(w - th - o, th + o, w - th - o, h - th - o, r); c.arcTo(w - th - o, h - th - o, th + o, h - th - o, r); c.arcTo(th + o, h - th - o, th + o, th + o, r); c.arcTo(th + o, th + o, w - th - o, th + o, r); c.stroke(); } },
  { id: "modern-sudut-hitam", name: "Sudut Hitam", category: "Modern", draw: (c, w, h) => {
    // Pola roundedBorder yang sama dengan bingkai rounded lain: tepi luar DAN
    // lubang dalam sama-sama persegi bulat radius r (sebelumnya lubang dalam
    // memakai rect bersudut tajam).
    const m = Math.min(w, h);
    roundedBorder(c, w, h, tp(m, 7), "#111111", round(m * 0.22));
  } },
  { id: "modern-film", name: "Film Strip", category: "Modern", draw: (c, w, h) => filmStrip(c, w, h, 18) },

  /* ---------- Booth (10) — elemen signature template photo booth ---------- */
  // Bunting: tali + segitiga bendera warna-warni di tepi atas (classic party booth).
  { id: "booth-bunting", name: "Bunting", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    border(c, w, h, tp(m, 4), "#ffffff");
    const y0 = tp(m, 4) * 0.6;
    const n = 10;
    const fw = w / n;
    const fh = Math.max(3, m * 0.09);
    c.strokeStyle = "rgba(0,0,0,0.25)";
    c.lineWidth = Math.max(1, m * 0.008);
    c.beginPath();
    c.moveTo(0, y0);
    c.lineTo(w, y0);
    c.stroke();
    for (let i = 0; i < n; i++) {
      c.fillStyle = PALETTE[i % PALETTE.length];
      const x = (i + 0.5) * fw;
      c.beginPath();
      c.moveTo(x - fw * 0.42, y0);
      c.lineTo(x + fw * 0.42, y0);
      c.lineTo(x, y0 + fh);
      c.closePath();
      c.fill();
    }
  } },
  // Strip hashtag di bawah — gaya photo booth media sosial; teks kustom lewat
  // opts.hashtagText (Auto Layout), default "#SENYUM".
  { id: "booth-hashtag", name: "Hashtag", category: "Booth", draw: (c, w, h, opts) => {
    const m = Math.min(w, h);
    const bh = Math.max(4, m * 0.16);
    border(c, w, h, tp(m, 4), "#ffffff");
    c.fillStyle = "#111111";
    c.fillRect(0, h - bh, w, bh);
    centeredText(c, opts?.hashtagText || "#SENYUM", w / 2, h - bh / 2, Math.max(3, m * 0.09), "#ffffff", w * 0.92);
  } },
  // Banner header "PHOTO BOOTH" — papan judul khas template booth; teks kustom
  // lewat opts.bannerText (Auto Layout), default "PHOTO BOOTH".
  { id: "booth-banner", name: "Banner PHOTO BOOTH", category: "Booth", draw: (c, w, h, opts) => {
    const m = Math.min(w, h);
    const bh = Math.max(4, m * 0.16);
    border(c, w, h, tp(m, 4), "#ffffff");
    c.fillStyle = "#d64550";
    c.fillRect(0, 0, w, bh);
    centeredText(c, opts?.bannerText || "PHOTO BOOTH", w / 2, bh / 2, Math.max(3, m * 0.085), "#ffffff", w * 0.92);
  } },
  // Washi tape: potongan selotip dekoratif tembus pandang di sudut atas.
  { id: "booth-washi", name: "Washi Tape", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    border(c, w, h, tp(m, 4), "#ffffff");
    const tapw = Math.max(6, m * 0.22);
    const taph = Math.max(3, m * 0.055);
    const o = tp(m, 4);
    for (const [x, y, rot] of [
      [o - 2, o - 2, -0.5],
      [w - o - tapw + 2, o - 2, 0.5],
    ] as Array<[number, number, number]>) {
      c.save();
      c.translate(x + tapw / 2, y + taph / 2);
      c.rotate(rot);
      c.fillStyle = "rgba(245, 212, 66, 0.75)";
      c.fillRect(-tapw / 2, -taph / 2, tapw, taph);
      c.restore();
    }
  } },
  // Polka dots warna-warni di sepanjang bingkai putih — gaya pesta Canva.
  { id: "booth-dots", name: "Titik Polka", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    const bw = tp(m, 4);
    border(c, w, h, bw, "#ffffff");
    const n = 10;
    const r = Math.max(1.5, m * 0.016);
    for (let i = 0; i <= n; i++) {
      const p = i / n;
      const x = p * w;
      const y = p * h;
      for (const [dx, dy] of [
        [x, bw / 2],
        [x, h - bw / 2],
        [bw / 2, y],
        [w - bw / 2, y],
      ] as Array<[number, number]>) {
        c.fillStyle = PALETTE[i % PALETTE.length];
        c.beginPath();
        c.arc(dx, dy, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  } },
  // Garis pelangi diagonal (candy stripes) di keempat sisi, ter-clip di band.
  { id: "booth-stripes", name: "Garis Pelangi", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    const bw = tp(m, 6);
    border(c, w, h, bw, "#ffffff");
    c.save();
    c.beginPath();
    c.rect(0, 0, w, bw);
    c.rect(0, h - bw, w, bw);
    c.rect(0, 0, bw, h);
    c.rect(w - bw, 0, bw, h);
    c.clip();
    const sw = Math.max(3, m * 0.05);
    const stripes = Math.ceil(w / (sw * 1.6)) + 2;
    for (let i = -1; i < stripes; i++) {
      c.fillStyle = PALETTE[(i + 10) % PALETTE.length];
      c.save();
      c.translate(i * sw * 1.6, 0);
      c.rotate(-0.6);
      c.fillRect(0, -h, sw, h * 3);
      c.restore();
    }
    c.restore();
  } },
  // Stempel tanggal: kotak putih garis putus-putus, sedikit miring, di pojok.
  { id: "booth-stempel", name: "Stempel Tanggal", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    border(c, w, h, tp(m, 4), "#ffffff");
    const sw2 = Math.max(14, m * 0.3);
    const sh2 = Math.max(8, m * 0.13);
    const o = tp(m, 5);
    c.save();
    c.translate(w - sw2 / 2 - o, h - sh2 / 2 - o);
    c.rotate(-0.12);
    c.fillStyle = "rgba(255,255,255,0.92)";
    c.fillRect(-sw2 / 2, -sh2 / 2, sw2, sh2);
    c.strokeStyle = "#c0392b";
    c.lineWidth = Math.max(1, m * 0.008);
    c.setLineDash([Math.max(2, m * 0.03), Math.max(2, m * 0.02)]);
    c.strokeRect(-sw2 / 2, -sh2 / 2, sw2, sh2);
    c.setLineDash([]);
    centeredText(c, "2026", 0, -sh2 * 0.12, Math.max(3, m * 0.05), "#333333");
    centeredText(c, "BOOTH", 0, sh2 * 0.3, Math.max(2.5, m * 0.032), "#c0392b");
    c.restore();
  } },
  // Viewfinder kamera: kurung sudut tebal + crosshair tengah.
  { id: "booth-kamera", name: "Viewfinder", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    border(c, w, h, tp(m, 3), "#ffffff");
    c.strokeStyle = "#111111";
    c.lineWidth = Math.max(2, m * 0.03);
    const o = tp(m, 5);
    const L = Math.max(6, m * 0.1);
    c.beginPath();
    c.moveTo(o, o + L); c.lineTo(o, o); c.lineTo(o + L, o);
    c.moveTo(w - o - L, o); c.lineTo(w - o, o); c.lineTo(w - o, o + L);
    c.moveTo(o, h - o - L); c.lineTo(o, h - o); c.lineTo(o + L, h - o);
    c.moveTo(w - o - L, h - o); c.lineTo(w - o, h - o); c.lineTo(w - o, h - o - L);
    c.stroke();
    const cr = Math.max(2, m * 0.035);
    const cl = Math.max(4, m * 0.07);
    c.beginPath();
    c.arc(w / 2, h / 2, cr, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(w / 2 - cl, h / 2); c.lineTo(w / 2 + cl, h / 2);
    c.moveTo(w / 2, h / 2 - cl); c.lineTo(w / 2, h / 2 + cl);
    c.stroke();
  } },
  // Warna cerah: empat sisi berbeda warna (gaya color-block Canva).
  { id: "booth-warna", name: "Warna Cerah", category: "Booth", draw: (c, w, h) => {
    const m = Math.min(w, h);
    border(c, w, h, tp(m, 2), "#ffffff");
    const bw = tp(m, 5);
    const cols = ["#f15bb5", "#00bbf9", "#ffe066", "#2a9d8f"];
    c.fillStyle = cols[0]; c.fillRect(0, 0, w, bw);
    c.fillStyle = cols[1]; c.fillRect(0, h - bw, w, bw);
    c.fillStyle = cols[2]; c.fillRect(0, 0, bw, h);
    c.fillStyle = cols[3]; c.fillRect(w - bw, 0, bw, h);
  } },
  // Hashtag + confetti dalam band: strip warna dengan bintik pesta; teks kustom
  // lewat opts.hashtagText (Auto Layout), default "#SENYUM".
  { id: "booth-hashtag-warna", name: "Hashtag Confetti", category: "Booth", draw: (c, w, h, opts) => {
    const m = Math.min(w, h);
    const bh = Math.max(4, m * 0.16);
    border(c, w, h, tp(m, 3), "#ffffff");
    c.fillStyle = "#d64550";
    c.fillRect(0, h - bh, w, bh);
    const rnd = seeded(41);
    for (let i = 0; i < 14; i++) {
      c.fillStyle = PALETTE[Math.floor(rnd() * PALETTE.length)];
      const r = Math.max(1, m * 0.012);
      c.beginPath();
      c.arc(rnd() * w, h - bh + rnd() * bh, r, 0, Math.PI * 2);
      c.fill();
    }
    centeredText(c, opts?.hashtagText || "#SENYUM", w / 2, h - bh / 2, Math.max(3, m * 0.085), "#ffffff", w * 0.92);
  } },
];

/** Cari bingkai berdasarkan id; `undefined` bila tidak ditemukan. */
export function getFrame(id: string): PhotoFrame | undefined {
  return FRAMES.find((f) => f.id === id);
}

/** Normalisasi id bingkai: kembalikan id bila ada di katalog, "" (Tanpa
 *  bingkai) bila tidak dikenal atau kosong. Dipakai FramePicker sebagai
 *  pertahanan lapisan kedua — konsumen lain tidak wajib memvalidasi manual. */
export function validFrameId(id: string): string {
  return getFrame(id) ? id : "";
}

/**
 * Terapkan bingkai ke gambar (URL): foto dimuat, dipotong cover agar mengisi
 * target (targetW × targetH px), lalu overlay bingkai digambar di atasnya.
 * `opts` diteruskan ke draw (teks kustom bingkai Booth). Mengembalikan data
 * URL PNG hasil.
 */
export function applyFrame(
  url: string,
  frame: PhotoFrame,
  targetW: number,
  targetH: number,
  opts?: FrameDrawOptions
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(targetW));
      canvas.height = Math.max(1, Math.round(targetH));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D tidak tersedia"));
        return;
      }
      // object-fit: cover — perbesar & potong agar foto mengisi penuh.
      const s = Math.max(
        canvas.width / img.naturalWidth,
        canvas.height / img.naturalHeight
      );
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(
        img,
        (canvas.width - dw) / 2,
        (canvas.height - dh) / 2,
        dw,
        dh
      );
      try {
        frame.draw(ctx, canvas.width, canvas.height, opts);
      } catch {
        // bingkai gagal digambar — biarkan foto asli
      }
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Gagal memuat foto untuk bingkai."));
    img.src = url;
  });
}
