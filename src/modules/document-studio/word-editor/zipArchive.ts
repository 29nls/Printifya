/**
 * Minimal ZIP generator murni (PKZip uncompressed / stored store-only).
 * Tidak membutuhkan dependensi eksternal, bekerja 100% di browser dan Node.js/jsdom.
 */

// Tabel CRC32
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c >>> 0;
}

function calculateCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/**
 * Membuat archive ZIP dalam bentuk Uint8Array dari daftar file.
 */
export function createZipArchive(entries: ZipEntry[]): Uint8Array {
  const fileRecords: {
    header: Uint8Array;
    nameBytes: Uint8Array;
    dataBytes: Uint8Array;
    offset: number;
    crc: number;
  }[] = [];

  let currentOffset = 0;

  for (const entry of entries) {
    const dataBytes =
      typeof entry.data === "string" ? encodeUtf8(entry.data) : entry.data;
    const nameBytes = encodeUtf8(entry.name);
    const crc = calculateCrc32(dataBytes);

    // Local file header (30 bytes)
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true); // Local file header signature
    view.setUint16(4, 20, true); // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(8, 0, true); // Compression method (0 = Stored/Uncompressed)
    view.setUint16(10, 0, true); // File last mod time
    view.setUint16(12, 0, true); // File last mod date
    view.setUint32(14, crc, true); // CRC-32
    view.setUint32(18, dataBytes.length, true); // Compressed size
    view.setUint32(22, dataBytes.length, true); // Uncompressed size
    view.setUint16(26, nameBytes.length, true); // File name length
    view.setUint16(28, 0, true); // Extra field length

    fileRecords.push({
      header,
      nameBytes,
      dataBytes,
      offset: currentOffset,
      crc,
    });

    currentOffset += 30 + nameBytes.length + dataBytes.length;
  }

  const centralDirOffset = currentOffset;
  const centralDirHeaders: Uint8Array[] = [];

  for (const rec of fileRecords) {
    // Central directory file header (46 bytes)
    const cdHeader = new Uint8Array(46);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true); // Central directory header signature
    view.setUint16(4, 20, true); // Version made by
    view.setUint16(6, 20, true); // Version needed to extract
    view.setUint16(8, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(10, 0, true); // Compression method (0)
    view.setUint16(12, 0, true); // File mod time
    view.setUint16(14, 0, true); // File mod date
    view.setUint32(16, rec.crc, true); // CRC-32
    view.setUint32(20, rec.dataBytes.length, true); // Compressed size
    view.setUint32(24, rec.dataBytes.length, true); // Uncompressed size
    view.setUint16(28, rec.nameBytes.length, true); // File name length
    view.setUint16(30, 0, true); // Extra field length
    view.setUint16(32, 0, true); // File comment length
    view.setUint16(34, 0, true); // Disk number where file starts
    view.setUint16(36, 0, true); // Internal file attributes
    view.setUint32(38, 0, true); // External file attributes
    view.setUint32(42, rec.offset, true); // Relative offset of local file header

    centralDirHeaders.push(cdHeader);
    currentOffset += 46 + rec.nameBytes.length;
  }

  const centralDirSize = currentOffset - centralDirOffset;

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true); // End of central dir signature
  eocdView.setUint16(4, 0, true); // Number of this disk
  eocdView.setUint16(6, 0, true); // Disk where central directory starts
  eocdView.setUint16(8, fileRecords.length, true); // Number of central directory records on this disk
  eocdView.setUint16(10, fileRecords.length, true); // Total number of central directory records
  eocdView.setUint32(12, centralDirSize, true); // Size of central directory
  eocdView.setUint32(16, centralDirOffset, true); // Offset of start of central directory
  eocdView.setUint16(20, 0, true); // Comment length

  const totalSize = currentOffset + 22;
  const out = new Uint8Array(totalSize);

  let pos = 0;
  for (const rec of fileRecords) {
    out.set(rec.header, pos);
    pos += rec.header.length;
    out.set(rec.nameBytes, pos);
    pos += rec.nameBytes.length;
    out.set(rec.dataBytes, pos);
    pos += rec.dataBytes.length;
  }

  for (let i = 0; i < fileRecords.length; i++) {
    const rec = fileRecords[i];
    const cd = centralDirHeaders[i];
    out.set(cd, pos);
    pos += cd.length;
    out.set(rec.nameBytes, pos);
    pos += rec.nameBytes.length;
  }

  out.set(eocd, pos);

  return out;
}
