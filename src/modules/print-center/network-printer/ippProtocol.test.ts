import { describe, it, expect } from "vitest";
import {
  buildGetPrinterAttributesPacket,
  buildPrintJobPacket,
  parseIppResponse,
  IPP_VERSION_1_1,
  IPP_VERSION_2_0,
  IPP_OPERATIONS,
  IPP_DELIMITERS,
  IPP_TAGS,
} from "./ippProtocol";

describe("IPP Protocol Packet Builder & Parser", () => {
  it("membangun paket Get-Printer-Attributes sesuai standar RFC 8010", () => {
    const packet = buildGetPrinterAttributesPacket({
      printerUri: "ipp://192.168.1.100:631/ipp/print",
      requestId: 1234,
      version: IPP_VERSION_1_1,
      charset: "utf-8",
      language: "en-us",
      requestedAttributes: ["printer-state", "printer-is-accepting-jobs"],
    });

    // Verifikasi header
    expect(packet[0]).toBe(1); // major 1
    expect(packet[1]).toBe(1); // minor 1
    const opId = (packet[2] << 8) | packet[3];
    expect(opId).toBe(IPP_OPERATIONS.GET_PRINTER_ATTRIBUTES); // 0x000B

    const reqId =
      ((packet[4] << 24) >>> 0) +
      ((packet[5] << 16) | (packet[6] << 8) | packet[7]);
    expect(reqId).toBe(1234);

    // Verifikasi delimiter grup attributes (0x01) dan end delimiter (0x03)
    expect(packet[8]).toBe(IPP_DELIMITERS.OPERATION_ATTRIBUTES);
    expect(packet[packet.length - 1]).toBe(IPP_DELIMITERS.END_OF_ATTRIBUTES);
  });

  it("membangun paket Print-Job dengan metadata dan lampiran payload dokumen", () => {
    const dummyDoc = new TextEncoder().encode("Hello ESC/POS Printifya Network");
    const packet = buildPrintJobPacket({
      printerUri: "ipp://192.168.1.50/ipp/printer",
      documentData: dummyDoc,
      jobName: "Struk Pembelian #101",
      userName: "kasir1",
      mimeType: "application/octet-stream",
      requestId: 99,
      version: IPP_VERSION_2_0,
    });

    expect(packet[0]).toBe(2); // major 2
    expect(packet[1]).toBe(0); // minor 0
    const opId = (packet[2] << 8) | packet[3];
    expect(opId).toBe(IPP_OPERATIONS.PRINT_JOB); // 0x0002

    // Pastikan dokumen terlampir tepat setelah 0x03 (END_OF_ATTRIBUTES)
    const endAttrIndex = packet.indexOf(IPP_DELIMITERS.END_OF_ATTRIBUTES);
    expect(endAttrIndex).toBeGreaterThan(0);
    const attachedPayload = packet.subarray(endAttrIndex + 1);
    expect(new TextDecoder().decode(attachedPayload)).toBe("Hello ESC/POS Printifya Network");
  });

  it("melakukan parsing biner IPP response dan memetakan status code 0x0000 (successful-ok)", () => {
    // Sintesis biner IPP response valid:
    // Version: 1.1 (0x01, 0x01)
    // Status-code: 0x0000 (successful-ok)
    // Request-id: 1 (0x00, 0x00, 0x00, 0x01)
    // Group: Operation Attributes (0x01)
    // Attribute: charset "utf-8"
    // End of attributes: 0x03
    const respBytes = new Uint8Array([
      0x01, 0x01, // v1.1
      0x00, 0x00, // status 0x0000 ok
      0x00, 0x00, 0x00, 0x01, // reqId 1
      0x01, // op attr tag
      IPP_TAGS.CHARSET,
      0x00, 0x12, // name length 18 ("attributes-charset")
      ...new TextEncoder().encode("attributes-charset"),
      0x00, 0x05, // val length 5 ("utf-8")
      ...new TextEncoder().encode("utf-8"),
      0x03, // end of attributes
    ]);

    const parsed = parseIppResponse(respBytes);
    expect(parsed.version).toEqual({ major: 1, minor: 1 });
    expect(parsed.statusCode).toBe(0x0000);
    expect(parsed.statusMessage).toBe("successful-ok");
    expect(parsed.requestId).toBe(1);
    expect(parsed.operationAttributes["attributes-charset"]).toBe("utf-8");
  });

  it("memetakan status code error IPP (misal client-error-not-authorized 0x0403)", () => {
    const respError = new Uint8Array([
      0x01, 0x01, // v1.1
      0x04, 0x03, // status 0x0403 (client-error-not-authorized)
      0x00, 0x00, 0x00, 0x05, // reqId 5
      0x03, // end of attributes
    ]);

    const parsed = parseIppResponse(respError);
    expect(parsed.statusCode).toBe(0x0403);
    expect(parsed.statusMessage).toBe("client-error-not-authorized");
  });

  it("melempar exception yang jelas jika data respons kurang dari 8 bytes", () => {
    const invalidShort = new Uint8Array([0x01, 0x01, 0x00]);
    expect(() => parseIppResponse(invalidShort)).toThrowError(/terlalu pendek/);
  });
});
