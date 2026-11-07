/**
 * IPP (Internet Printing Protocol - RFC 8010 & RFC 8011) Packet Builder & Parser murni.
 * Mendukung pembentukan payload biner IPP v1.1 / v2.0 untuk:
 * - Get-Printer-Attributes (0x000B)
 * - Print-Job (0x0002)
 * Serta decoding respons biner IPP dan pemetaan status code.
 */

export interface IppVersion {
  major: number;
  minor: number;
}

export const IPP_VERSION_1_1: IppVersion = { major: 1, minor: 1 };
export const IPP_VERSION_2_0: IppVersion = { major: 2, minor: 0 };

export const IPP_OPERATIONS = {
  PRINT_JOB: 0x0002,
  VALIDATE_JOB: 0x0004,
  CANCEL_JOB: 0x0008,
  GET_PRINTER_ATTRIBUTES: 0x000b,
  GET_JOBS: 0x000a,
} as const;

export const IPP_DELIMITERS = {
  OPERATION_ATTRIBUTES: 0x01,
  JOB_ATTRIBUTES: 0x02,
  END_OF_ATTRIBUTES: 0x03,
  PRINTER_ATTRIBUTES: 0x04,
  UNSUPPORTED_ATTRIBUTES: 0x05,
} as const;

export const IPP_TAGS = {
  INTEGER: 0x21,
  BOOLEAN: 0x22,
  ENUM: 0x23,
  OCTET_STRING: 0x30,
  TEXT_WITHOUT_LANGUAGE: 0x41,
  NAME_WITHOUT_LANGUAGE: 0x42,
  KEYWORD: 0x44,
  URI: 0x45,
  CHARSET: 0x47,
  NATURAL_LANGUAGE: 0x48,
  MIME_MEDIA_TYPE: 0x49,
} as const;

export const IPP_STATUS_CODES: Record<number, string> = {
  0x0000: "successful-ok",
  0x0001: "successful-ok-ignored-or-substituted-attributes",
  0x0002: "successful-ok-conflicting-attributes",
  0x0400: "client-error-bad-request",
  0x0401: "client-error-forbidden",
  0x0402: "client-error-not-authenticated",
  0x0403: "client-error-not-authorized",
  0x0404: "client-error-not-possible",
  0x0405: "client-error-timeout",
  0x0406: "client-error-not-found",
  0x0407: "client-error-gone",
  0x0408: "client-error-request-entity-too-large",
  0x0409: "client-error-request-value-too-long",
  0x040a: "client-error-document-format-not-supported",
  0x040b: "client-error-attributes-or-values-not-supported",
  0x0500: "server-error-internal-error",
  0x0501: "server-error-operation-not-supported",
  0x0502: "server-error-service-unavailable",
  0x0503: "server-error-version-not-supported",
  0x0504: "server-error-device-error",
  0x0505: "server-error-temporary-error",
  0x0506: "server-error-not-accepting-jobs",
};

export function getIppStatusMessage(statusCode: number): string {
  return IPP_STATUS_CODES[statusCode] || `unknown-status-code-0x${statusCode.toString(16).padStart(4, "0")}`;
}

export interface IppAttribute {
  tag: number;
  name: string;
  value: string | number | boolean;
}

export interface IppResponse {
  version: IppVersion;
  statusCode: number;
  statusMessage: string;
  requestId: number;
  operationAttributes: Record<string, string | number | boolean | string[]>;
  printerAttributes?: Record<string, string | number | boolean | string[]>;
  jobAttributes?: Record<string, string | number | boolean | string[]>;
  data?: Uint8Array;
}

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;

  writeUint8(val: number): void {
    const buf = new Uint8Array([val & 0xff]);
    this.chunks.push(buf);
    this.totalLength += 1;
  }

  writeUint16(val: number): void {
    const buf = new Uint8Array([(val >> 8) & 0xff, val & 0xff]);
    this.chunks.push(buf);
    this.totalLength += 2;
  }

  writeInt32(val: number): void {
    const buf = new Uint8Array([
      (val >> 24) & 0xff,
      (val >> 16) & 0xff,
      (val >> 8) & 0xff,
      val & 0xff,
    ]);
    this.chunks.push(buf);
    this.totalLength += 4;
  }

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.totalLength += bytes.length;
  }

  writeString(str: string): void {
    const encoder = new TextEncoder();
    this.writeBytes(encoder.encode(str));
  }

  writeAttribute(tag: number, name: string, value: string | number | boolean): void {
    this.writeUint8(tag);

    // Name-length & name
    const encoder = new TextEncoder();
    const nameBytes = encoder.encode(name);
    this.writeUint16(nameBytes.length);
    this.writeBytes(nameBytes);

    // Value-length & value
    if (tag === IPP_TAGS.BOOLEAN) {
      this.writeUint16(1);
      this.writeUint8(value ? 1 : 0);
    } else if (tag === IPP_TAGS.INTEGER || tag === IPP_TAGS.ENUM) {
      this.writeUint16(4);
      this.writeInt32(Number(value));
    } else {
      const valBytes = encoder.encode(String(value));
      this.writeUint16(valBytes.length);
      this.writeBytes(valBytes);
    }
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

/**
 * Membangun paket IPP Get-Printer-Attributes
 */
export function buildGetPrinterAttributesPacket(options: {
  printerUri: string;
  requestId?: number;
  version?: IppVersion;
  charset?: string;
  language?: string;
  requestedAttributes?: string[];
}): Uint8Array {
  const version = options.version || IPP_VERSION_1_1;
  const requestId = options.requestId ?? 1;
  const charset = options.charset || "utf-8";
  const language = options.language || "en";

  const writer = new ByteWriter();

  // 1. Version-number (2 bytes)
  writer.writeUint8(version.major);
  writer.writeUint8(version.minor);

  // 2. Operation-id (2 bytes: 0x000B)
  writer.writeUint16(IPP_OPERATIONS.GET_PRINTER_ATTRIBUTES);

  // 3. Request-id (4 bytes)
  writer.writeInt32(requestId);

  // 4. Operation Attributes Tag (0x01)
  writer.writeUint8(IPP_DELIMITERS.OPERATION_ATTRIBUTES);

  // Attributes: attributes-charset & attributes-natural-language wajib pertama
  writer.writeAttribute(IPP_TAGS.CHARSET, "attributes-charset", charset);
  writer.writeAttribute(IPP_TAGS.NATURAL_LANGUAGE, "attributes-natural-language", language);
  writer.writeAttribute(IPP_TAGS.URI, "printer-uri", options.printerUri);

  if (options.requestedAttributes && options.requestedAttributes.length > 0) {
    for (const attr of options.requestedAttributes) {
      writer.writeAttribute(IPP_TAGS.KEYWORD, "requested-attributes", attr);
    }
  }

  // 5. End of Attributes Tag (0x03)
  writer.writeUint8(IPP_DELIMITERS.END_OF_ATTRIBUTES);

  return writer.toUint8Array();
}

/**
 * Membangun paket IPP Print-Job lengkap dengan document data
 */
export function buildPrintJobPacket(options: {
  printerUri: string;
  documentData: Uint8Array;
  jobName?: string;
  userName?: string;
  mimeType?: string;
  requestId?: number;
  version?: IppVersion;
  charset?: string;
  language?: string;
}): Uint8Array {
  const version = options.version || IPP_VERSION_1_1;
  const requestId = options.requestId ?? 1;
  const charset = options.charset || "utf-8";
  const language = options.language || "en";
  const jobName = options.jobName || "Printifya Job";
  const userName = options.userName || "printifya";
  const mimeType = options.mimeType || "application/octet-stream";

  const writer = new ByteWriter();

  // 1. Version-number (2 bytes)
  writer.writeUint8(version.major);
  writer.writeUint8(version.minor);

  // 2. Operation-id (2 bytes: 0x0002 = Print-Job)
  writer.writeUint16(IPP_OPERATIONS.PRINT_JOB);

  // 3. Request-id (4 bytes)
  writer.writeInt32(requestId);

  // 4. Operation Attributes Tag (0x01)
  writer.writeUint8(IPP_DELIMITERS.OPERATION_ATTRIBUTES);

  writer.writeAttribute(IPP_TAGS.CHARSET, "attributes-charset", charset);
  writer.writeAttribute(IPP_TAGS.NATURAL_LANGUAGE, "attributes-natural-language", language);
  writer.writeAttribute(IPP_TAGS.URI, "printer-uri", options.printerUri);
  writer.writeAttribute(IPP_TAGS.NAME_WITHOUT_LANGUAGE, "requesting-user-name", userName);
  writer.writeAttribute(IPP_TAGS.NAME_WITHOUT_LANGUAGE, "job-name", jobName);
  writer.writeAttribute(IPP_TAGS.MIME_MEDIA_TYPE, "document-format", mimeType);

  // 5. End of Attributes Tag (0x03)
  writer.writeUint8(IPP_DELIMITERS.END_OF_ATTRIBUTES);

  // 6. Data Dokumen (setelah End of Attributes Tag)
  writer.writeBytes(options.documentData);

  return writer.toUint8Array();
}

/**
 * Parser respons biner IPP
 */
export function parseIppResponse(buffer: Uint8Array | ArrayBuffer): IppResponse {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 8) {
    throw new Error(`Data IPP respons terlalu pendek (${bytes.length} bytes, minimal 8 bytes).`);
  }

  const major = bytes[0];
  const minor = bytes[1];
  const statusCode = (bytes[2] << 8) | bytes[3];
  const requestId =
    ((bytes[4] << 24) >>> 0) +
    ((bytes[5] << 16) | (bytes[6] << 8) | bytes[7]);

  const operationAttributes: Record<string, string | number | boolean | string[]> = {};
  const printerAttributes: Record<string, string | number | boolean | string[]> = {};
  const jobAttributes: Record<string, string | number | boolean | string[]> = {};

  let currentGroup: Record<string, string | number | boolean | string[]> = operationAttributes;
  let offset = 8;
  const decoder = new TextDecoder();

  while (offset < bytes.length) {
    const tag = bytes[offset++];
    if (tag === IPP_DELIMITERS.END_OF_ATTRIBUTES) {
      break;
    }

    if (tag === IPP_DELIMITERS.OPERATION_ATTRIBUTES) {
      currentGroup = operationAttributes;
      continue;
    }
    if (tag === IPP_DELIMITERS.PRINTER_ATTRIBUTES) {
      currentGroup = printerAttributes;
      continue;
    }
    if (tag === IPP_DELIMITERS.JOB_ATTRIBUTES) {
      currentGroup = jobAttributes;
      continue;
    }

    // Jika tag delimiter grup lain (0x00 - 0x0F)
    if (tag <= 0x0f) {
      continue;
    }

    // Baca attribute: name-length (2) + name + value-length (2) + value
    if (offset + 2 > bytes.length) break;
    const nameLength = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    let name = "";
    if (nameLength > 0 && offset + nameLength <= bytes.length) {
      name = decoder.decode(bytes.subarray(offset, offset + nameLength));
      offset += nameLength;
    }

    if (offset + 2 > bytes.length) break;
    const valueLength = (bytes[offset] << 8) | bytes[offset + 1];
    offset += 2;

    let parsedVal: string | number | boolean = "";
    if (valueLength > 0 && offset + valueLength <= bytes.length) {
      const valSlice = bytes.subarray(offset, offset + valueLength);
      if (tag === IPP_TAGS.BOOLEAN) {
        parsedVal = valSlice[0] !== 0;
      } else if (tag === IPP_TAGS.INTEGER || tag === IPP_TAGS.ENUM) {
        if (valueLength === 4) {
          parsedVal =
            ((valSlice[0] << 24) >>> 0) +
            ((valSlice[1] << 16) | (valSlice[2] << 8) | valSlice[3]);
        }
      } else {
        parsedVal = decoder.decode(valSlice);
      }
      offset += valueLength;
    }

    if (name) {
      if (name in currentGroup) {
        const existing = currentGroup[name];
        if (Array.isArray(existing)) {
          existing.push(String(parsedVal));
        } else {
          currentGroup[name] = [String(existing), String(parsedVal)];
        }
      } else {
        currentGroup[name] = parsedVal;
      }
    }
  }

  let extraData: Uint8Array | undefined;
  if (offset < bytes.length) {
    extraData = bytes.subarray(offset);
  }

  return {
    version: { major, minor },
    statusCode,
    statusMessage: getIppStatusMessage(statusCode),
    requestId,
    operationAttributes,
    printerAttributes,
    jobAttributes,
    data: extraData,
  };
}
