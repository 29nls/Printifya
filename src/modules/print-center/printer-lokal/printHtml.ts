import type { PasFotoSize } from "../../photo-studio/shared/pasFotoSize";

export interface HtmlSheetOptions {
  cols: number;
  rows: number;
  marginCm: number;
}

const PAGE_W_MM = 210; // A4
const PAGE_H_MM = 297; // A4

/**
 * Bangun dokumen HTML mandiri berisi grid pas foto A4 dengan ukuran fisik
 * presisi (mm) — alternatif cetak tanpa jsPDF.
 *
 * `src` bisa berupa satu gambar (diulang di semua sel — pola pas foto) atau
 * daftar gambar yang diisi sel per sel; bila lebih banyak dari jumlah sel,
 * dibuat halaman tambahan secara otomatis (Auto Layout).
 */
export function buildHtmlSheet(
  src: string | string[],
  size: PasFotoSize,
  { cols, rows, marginCm }: HtmlSheetOptions
): string {
  const gridW = size.widthMm * cols;
  const gridH = size.heightMm * rows;
  const marginX = Math.max(marginCm * 10, (PAGE_W_MM - gridW) / 2);
  const marginY = Math.max(marginCm * 10, (PAGE_H_MM - gridH) / 2);
  const count = cols * rows;

  const srcs = Array.isArray(src)
    ? src
    : Array.from({ length: count }, () => src);
  const pages = Math.max(1, Math.ceil(srcs.length / count));

  const pageDivs: string[] = [];
  for (let p = 0; p < pages; p++) {
    const cells: string[] = [];
    for (let i = 0; i < count; i++) {
      const idx = p * count + i;
      cells.push(
        idx < srcs.length
          ? `<img src="${srcs[idx]}" alt="" />`
          : `<div class="empty"></div>`
      );
    }
    pageDivs.push(`<div class="page"><div class="sheet">\n${cells.join("\n")}\n</div></div>`);
  }

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>Template A4 ${size.label}</title>
<style>
  @page { size: A4 portrait; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 210mm; }
  .page {
    position: relative;
    width: ${PAGE_W_MM}mm;
    height: ${PAGE_H_MM}mm;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; }
  .sheet {
    position: absolute;
    left: ${marginX}mm;
    top: ${marginY}mm;
    width: ${gridW}mm;
    height: ${gridH}mm;
    display: grid;
    grid-template-columns: repeat(${cols}, ${size.widthMm}mm);
    grid-template-rows: repeat(${rows}, ${size.heightMm}mm);
    gap: 0;
  }
  .sheet img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .sheet .empty { background: #ffffff; }
</style>
</head>
<body>
${pageDivs.join("\n")}
</body>
</html>`;
}

/**
 * Cetak dokumen HTML lewat iframe tersembunyi + dialog print browser.
 * Mengembalikan `false` bila iframe tidak tersedia (jarang terjadi).
 */
export function printHtmlSheet(html: string): boolean {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  document.body.appendChild(iframe);

  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return false;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  let triggered = false;
  const trigger = () => {
    if (triggered) return;
    triggered = true;
    win.focus();
    win.print();
    setTimeout(() => iframe.remove(), 60000);
  };

  // Tunggu semua gambar termuat agar sheet utuh sebelum dialog cetak muncul.
  const images = Array.from(win.document.images);
  if (images.length === 0) {
    trigger();
  } else {
    let remaining = images.length;
    const done = () => {
      remaining -= 1;
      if (remaining <= 0) trigger();
    };
    images.forEach((img) => {
      if (img.complete) done();
      else {
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      }
    });
    setTimeout(trigger, 3000); // jaring pengaman bila gambar lambat
  }

  return true;
}
