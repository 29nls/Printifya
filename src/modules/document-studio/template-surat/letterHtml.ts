/**
 * Bantuan untuk surat resmi Indonesia: format tanggal, nomor surat otomatis
 * (urutan/KODE/BULAN-ROMawi/TAHUN), dan pembangun HTML A4 siap cetak —
 * memakai pola cetak HTML yang sama dengan Printer Lokal / Word Editor.
 */

export interface LetterData {
  instansi: string;
  alamat: string;
  logo: string | null;
  kode: string;
  seq: number;
  tanggal: string; // ISO yyyy-mm-dd
  nomor: string; // nomor surat final (otomatis)
  lampiran: string;
  perihal: string;
  kepada: string;
  isi: string;
  penutup: string;
  nama: string;
  jabatan: string;
}

/** Bidang surat tanpa nomor (nomor diturunkan otomatis dari seq/kode/tanggal). */
export type LetterFields = Omit<LetterData, "nomor">;

const NAMA_BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Format tanggal ISO ke bentuk Indonesia, mis. "15 Agustus 2026". */
export function formatTanggal(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} ${NAMA_BULAN[m - 1]} ${y}`;
}

/** Nomor surat otomatis: "001/PRINTIFYA/VIII/2026". */
export function autoNomor(seq: number, kode: string, tanggalIso: string): string {
  const [y, m] = tanggalIso.split("-").map(Number);
  const bulan = m >= 1 && m <= 12 ? ROMAN[m - 1] : "?";
  const kodeBersih = (kode || "SURAT").toUpperCase().replace(/\s+/g, "");
  return `${String(Math.max(1, seq)).padStart(3, "0")}/${kodeBersih}/${bulan}/${y || "????"}`;
}

/** Pisahkan isi menjadi paragraf (dipisah baris kosong). */
export function splitParagraf(isi: string): string[] {
  return isi
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function esc(text: string): string {
  return text.replace(/[<>&"]/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : "&quot;"
  );
}

/** Bangun dokumen HTML A4 siap cetak dari data surat. */
export function buildLetterHtml(data: LetterData): string {
  const paragraf = splitParagraf(data.isi);
  const body = paragraf.map((p) => `<p>${esc(p)}</p>`).join("\n");

  const kopLogo = data.logo
    ? `<div class="kop-logo"><img src="${data.logo}" alt="Logo" /></div>`
    : "";

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${esc(data.perihal || "Surat Resmi")}</title>
<style>
  @page { size: A4 portrait; margin: 25mm 22mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Georgia, serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #111;
  }
  .kop {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    text-align: center;
    padding-bottom: 10pt;
    border-bottom: 3px solid #111;
    margin-bottom: 4pt;
  }
  .kop + .kop-line { border-bottom: 1px solid #111; margin-bottom: 16pt; }
  .kop-logo img { height: 60pt; width: auto; }
  .kop .instansi {
    font-size: 17pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1pt;
  }
  .kop .alamat { font-size: 10pt; margin-top: 2pt; }
  .meta { margin: 0 0 12pt; font-size: 12pt; }
  .meta p { margin: 0 0 2pt; }
  .meta .field { display: inline-block; width: 74pt; }
  .kepada { margin: 8pt 0 0; }
  .salam { margin: 12pt 0; }
  .body p { margin: 0 0 8pt; text-align: justify; }
  .penutup { margin: 10pt 0; }
  .ttd {
    margin-top: 28pt;
    text-align: center;
    width: 220pt;
    margin-left: auto;
  }
  .ttd .jabatan { margin-bottom: 64pt; }
  .ttd .nama { font-weight: 700; text-decoration: underline; }
</style>
</head>
<body>
<div class="kop">${kopLogo}
  <div>
    <div class="instansi">${esc(data.instansi)}</div>
    <div class="alamat">${esc(data.alamat)}</div>
  </div>
</div>
<div class="kop-line"></div>

<div class="meta">
  <p><span class="field">Nomor</span>: ${esc(data.nomor)}</p>
  <p><span class="field">Lampiran</span>: ${esc(data.lampiran)}</p>
  <p><span class="field">Perihal</span>: ${esc(data.perihal)}</p>
  <p class="kepada">
    <span class="field">Kepada</span>: ${esc(data.kepada).replace(/\n/g, "<br />")}
  </p>
</div>

<div class="salam">Dengan hormat,</div>

<div class="body">
${body}
</div>

<p class="penutup">${esc(data.penutup)}</p>

<div class="ttd">
  <div class="jabatan">${esc(data.jabatan)}</div>
  <div class="nama">${esc(data.nama)}</div>
</div>
</body>
</html>`;
}
