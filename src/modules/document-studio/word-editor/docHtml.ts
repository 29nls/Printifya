/**
 * Bangun dokumen HTML A4 siap cetak dari konten rich text editor —
 * memakai pola cetak HTML yang sama dengan modul Printer Lokal
 * (printHtmlSheet: iframe tersembunyi + dialog cetak browser, yang juga
 * memungkinkan "Simpan sebagai PDF" dari dialog).
 */

/** Buang tag <script> dari konten agar teks yang ditempel tidak mengeksekusi kode saat dicetak. */
function sanitize(content: string): string {
  return content.replace(/<script[\s\S]*?<\/script>/gi, "");
}

export function buildDocHtml(title: string, content: string): string {
  const safeTitle =
    (title || "Dokumen").replace(/[<>&"]/g, (ch) =>
      ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : "&quot;"
    );

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<style>
  @page { size: A4 portrait; margin: 22mm 20mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 12pt;
    line-height: 1.6;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-title {
    font-size: 20pt;
    font-weight: 700;
    margin: 0 0 14pt;
    padding-bottom: 8pt;
    border-bottom: 2px solid #333;
  }
  h1 { font-size: 20pt; margin: 18pt 0 8pt; }
  h2 { font-size: 16pt; margin: 16pt 0 8pt; }
  h3 { font-size: 13.5pt; margin: 14pt 0 6pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt 20pt; padding: 0; }
  li { margin-bottom: 2pt; }
  blockquote {
    margin: 0 0 8pt 14pt;
    border-left: 3px solid #bbb;
    padding-left: 10pt;
    color: #444;
  }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8pt; }
  th, td { border: 1px solid #999; padding: 4pt 6pt; font-size: 11pt; }
  th { background: #f0f0f0; }
  img { max-width: 100%; }
  code, pre { font-family: Consolas, Menlo, monospace; font-size: 10.5pt; background: #f5f5f5; }
  pre { padding: 8pt; border-radius: 4pt; overflow: hidden; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
<div class="doc-title">${safeTitle}</div>
${sanitize(content)}
</body>
</html>`;
}
