/**
 * tableOps.ts
 *
 * Logika murni pembentukan dan manipulasi tabel HTML untuk Word Editor.
 * Terpisah dari komponen React agar dapat diuji secara independen dan deterministik.
 */

export interface TableOptions {
  rows: number;
  cols: number;
  hasHeader?: boolean;
}

/**
 * Bangun string HTML untuk tabel dengan jumlah baris dan kolom yang ditentukan.
 */
export function buildTableHtml(options: TableOptions): string {
  const rows = Math.max(1, Math.min(50, Math.floor(options.rows || 2)));
  const cols = Math.max(1, Math.min(20, Math.floor(options.cols || 2)));
  const hasHeader = options.hasHeader ?? true;

  const rowHtmls: string[] = [];

  for (let r = 0; r < rows; r++) {
    const isHeaderRow = r === 0 && hasHeader;
    const tag = isHeaderRow ? "th" : "td";
    const cells: string[] = [];

    for (let c = 0; c < cols; c++) {
      const defaultContent = isHeaderRow
        ? `Kolom ${c + 1}`
        : `<br>`;
      cells.push(`<${tag}>${defaultContent}</${tag}>`);
    }

    rowHtmls.push(`  <tr>\n    ${cells.join("")}\n  </tr>`);
  }

  return `<table class="doc-table">\n${rowHtmls.join("\n")}\n</table><p><br></p>`;
}

/**
 * Tambahkan baris baru ke tabel HTML string atau DOM TableElement.
 */
export function appendRowToTable(tableHtml: string): string {
  const colMatches = tableHtml.match(/<t[hd][^>]*>/gi);
  const rowMatches = tableHtml.match(/<tr[^>]*>/gi);
  const totalRows = rowMatches ? rowMatches.length : 1;
  const totalCols = colMatches ? Math.max(1, Math.floor(colMatches.length / totalRows)) : 2;

  const cells = Array.from({ length: totalCols }, () => `<td><br></td>`).join("");
  const newRow = `  <tr>${cells}</tr>`;

  if (tableHtml.includes("</tbody>")) {
    return tableHtml.replace("</tbody>", `${newRow}\n</tbody>`);
  }
  return tableHtml.replace("</table>", `${newRow}\n</table>`);
}

/**
 * Tambahkan kolom baru ke tabel HTML string.
 */
export function appendColToTable(tableHtml: string): string {
  let isFirstRow = true;
  return tableHtml.replace(/<\/tr>/gi, () => {
    const tag = isFirstRow ? "th" : "td";
    isFirstRow = false;
    return `<${tag}><br></${tag}></tr>`;
  });
}
