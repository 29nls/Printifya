/**
 * Generator dokumen .docx (OpenXML) client-side tanpa server Node.js.
 * Memetakan HTML rich text (paragraf, heading, bold, italic, list, tabel) ke OpenXML format.
 */

import { createZipArchive, type ZipEntry } from "./zipArchive";

export const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Konversi teks HTML sederhana editor ke potongan OpenXML <w:p> dan <w:tbl>.
 */
function htmlToWordXml(html: string): string {
  // Sederhanakan parsing HTML menggunakan parser teks / regex
  const xmlParts: string[] = [];

  // Tangani tabel jika ada
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const processTextBlocks = (text: string) => {
    // Normalisasi tag paragraf / div / heading
    const blocks = text
      .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n");

    for (const rawBlock of blocks) {
      const clean = rawBlock.replace(/<[^>]+>/g, "").trim();
      if (!clean) continue;

      // Cek heading
      const isH1 = /<h1/i.test(rawBlock);
      const isH2 = /<h2/i.test(rawBlock);
      const isBold = /<(b|strong)/i.test(rawBlock);
      const isItalic = /<(i|em)/i.test(rawBlock);

      let rPr = "";
      if (isH1) {
        rPr = '<w:rPr><w:b/><w:sz w:val="40"/></w:rPr>';
      } else if (isH2) {
        rPr = '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr>';
      } else if (isBold || isItalic) {
        rPr = `<w:rPr>${isBold ? "<w:b/>" : ""}${isItalic ? "<w:i/>" : ""}</w:rPr>`;
      }

      xmlParts.push(
        `<w:p>${rPr ? `<w:pPr>${isH1 || isH2 ? '<w:spacing w:before="240" w:after="120"/>' : ""}</w:pPr>` : ""}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(clean)}</w:t></w:r></w:p>`
      );
    }
  };

  while ((match = tableRegex.exec(html)) !== null) {
    const textBefore = html.slice(lastIndex, match.index);
    if (textBefore.trim()) processTextBlocks(textBefore);

    const tableHtml = match[0];
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    let tblXml =
      '<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>';

    for (const rHtml of rowMatches) {
      tblXml += "<w:tr>";
      const cellMatches = rHtml.match(/<(td|th)[\s\S]*?<\/(td|th)>/gi) || [];
      for (const cHtml of cellMatches) {
        const cellText = cHtml.replace(/<[^>]+>/g, "").trim();
        const isHeader = /<th/i.test(cHtml);
        tblXml += `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/>${isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/>' : ""}</w:tcPr><w:p><w:r>${isHeader ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t>${escapeXml(cellText)}</w:t></w:r></w:p></w:tc>`;
      }
      tblXml += "</w:tr>";
    }
    tblXml += "</w:tbl>";
    xmlParts.push(tblXml);

    lastIndex = match.index + match[0].length;
  }

  const textAfter = html.slice(lastIndex);
  if (textAfter.trim()) processTextBlocks(textAfter);

  if (xmlParts.length === 0) {
    xmlParts.push("<w:p><w:r><w:t></w:t></w:r></w:p>");
  }

  return xmlParts.join("");
}

/**
 * Bangun Blob file .docx siap diunduh oleh browser.
 */
export function buildDocxBlob(title: string, htmlContent: string): Blob {
  const safeTitle = escapeXml(title || "Dokumen");
  const bodyXml = htmlToWordXml(htmlContent);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p>
      <w:pPr>
        <w:pStyle w:val="Title"/>
        <w:spacing w:after="240"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="48"/>
        </w:rPr>
        <w:t>${safeTitle}</w:t>
      </w:r>
    </w:p>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const packageRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: packageRelsXml },
    { name: "word/document.xml", data: documentXml },
  ];

  const zipBytes = createZipArchive(entries);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: DOCX_MIME_TYPE });
}
