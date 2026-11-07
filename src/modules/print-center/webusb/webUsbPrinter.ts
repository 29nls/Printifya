/**
 * Driver WebUSB Printer murni untuk koneksi direct printing (ESC/POS & Raw Raster).
 * Mendukung pairing USB device, penemuan endpoint bulk OUT (printer class 0x07),
 * transfer biner, dan fallback aman saat WebUSB tidak tersedia / akses OS ditolak (Windows WinUSB claim error).
 */

export interface UsbPrinterDevice {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
}

export type UsbPrinterStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WebUsbPrinterResult {
  ok: boolean;
  message: string;
  bytesWritten?: number;
}

/** Tipe minimal interface USB standar WebUSB */
export interface MinimalUsbDevice {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  configuration?: {
    interfaces: {
      interfaceNumber: number;
      alternates: {
        interfaceClass: number;
        endpoints: {
          endpointNumber: number;
          direction: "in" | "out";
          type: "bulk" | "interrupt" | "isochronous";
        }[];
      }[];
    }[];
  } | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  selectConfiguration: (configValue: number) => Promise<void>;
  claimInterface: (interfaceNumber: number) => Promise<void>;
  releaseInterface: (interfaceNumber: number) => Promise<void>;
  transferOut: (
    endpointNumber: number,
    data: BufferSource
  ) => Promise<{ bytesWritten: number; status: "ok" | "stall" | "babble" }>;
}

export interface MinimalUsbNavigator {
  requestDevice: (options: {
    filters: { classCode?: number; vendorId?: number }[];
  }) => Promise<MinimalUsbDevice>;
  getDevices: () => Promise<MinimalUsbDevice[]>;
}

export class WebUsbPrinterDriver {
  private device: MinimalUsbDevice | null = null;
  private endpointNumber: number | null = null;
  private interfaceNumber: number | null = null;

  constructor(private usbNavigator?: MinimalUsbNavigator) {}

  private getUsb(): MinimalUsbNavigator | null {
    if (this.usbNavigator) return this.usbNavigator;
    if (typeof navigator !== "undefined" && "usb" in navigator) {
      return (navigator as unknown as { usb: MinimalUsbNavigator }).usb;
    }
    return null;
  }

  isSupported(): boolean {
    return this.getUsb() !== null;
  }

  isConnected(): boolean {
    return Boolean(this.device && this.device.opened);
  }

  getDeviceInfo(): UsbPrinterDevice | null {
    if (!this.device) return null;
    return {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      productName: this.device.productName,
      manufacturerName: this.device.manufacturerName,
    };
  }

  /**
   * Cari endpoint bulk OUT dari interface printer (class 0x07 atau interface pertama dengan bulk OUT).
   */
  private findEndpoint(device: MinimalUsbDevice): {
    interfaceNum: number;
    endpointNum: number;
  } | null {
    const config = device.configuration;
    if (!config || !config.interfaces) return null;

    for (const iface of config.interfaces) {
      for (const alt of iface.alternates) {
        // Class 7 = Printer Class di spesifikasi USB IF
        const isPrinterClass = alt.interfaceClass === 7 || alt.interfaceClass === 0;
        const outEndpoint = alt.endpoints.find(
          (ep) => ep.direction === "out" && ep.type === "bulk"
        );
        if (outEndpoint && isPrinterClass) {
          return {
            interfaceNum: iface.interfaceNumber,
            endpointNum: outEndpoint.endpointNumber,
          };
        }
      }
    }
    return null;
  }

  /**
   * Request pairing dan buka koneksi ke USB printer.
   */
  async requestAndConnect(): Promise<WebUsbPrinterResult> {
    const usb = this.getUsb();
    if (!usb) {
      return {
        ok: false,
        message:
          "WebUSB API tidak didukung di browser ini. Gunakan Chrome/Edge atau QZ Tray sebagai fallback.",
      };
    }

    try {
      const device = await usb.requestDevice({
        filters: [{ classCode: 7 }, {}], // Prioritaskan printer class
      });

      return await this.connectDevice(device);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Gagal memilih perangkat USB: ${msg}`,
      };
    }
  }

  async connectDevice(device: MinimalUsbDevice): Promise<WebUsbPrinterResult> {
    try {
      await device.open();

      if (!device.configuration) {
        await device.selectConfiguration(1);
      }

      const epInfo = this.findEndpoint(device);
      if (!epInfo) {
        await device.close().catch(() => {});
        return {
          ok: false,
          message:
            "Tidak ditemukan Bulk OUT endpoint untuk transfer data printer.",
        };
      }

      try {
        await device.claimInterface(epInfo.interfaceNum);
      } catch (claimErr) {
        await device.close().catch(() => {});
        return {
          ok: false,
          message:
            "Akses interface USB ditolak OS (misal: butuh WinUSB di Windows). Silakan gunakan QZ Tray sebagai alternatif.",
        };
      }

      this.device = device;
      this.interfaceNumber = epInfo.interfaceNum;
      this.endpointNumber = epInfo.endpointNum;

      return {
        ok: true,
        message: `Berhasil terhubung ke USB printer: ${device.productName || "USB Printer"}`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Koneksi USB gagal: ${msg}`,
      };
    }
  }

  /**
   * Kirim buffer biner (ESC/POS atau data mentah) ke printer via bulk transfer.
   */
  async printRaw(data: Uint8Array): Promise<WebUsbPrinterResult> {
    if (!this.device || !this.device.opened || this.endpointNumber === null) {
      return {
        ok: false,
        message: "Printer USB belum terhubung. Silakan pasang dan hubungkan dahulu.",
      };
    }

    try {
      const res = await this.device.transferOut(
        this.endpointNumber,
        data.buffer as ArrayBuffer
      );
      if (res.status === "ok") {
        return {
          ok: true,
          message: "Data cetak berhasil dikirim.",
          bytesWritten: res.bytesWritten,
        };
      } else {
        return {
          ok: false,
          message: `Transfer data USB status: ${res.status}`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Gagal mentransfer data cetak USB: ${msg}`,
      };
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        if (this.interfaceNumber !== null) {
          await this.device.releaseInterface(this.interfaceNumber).catch(() => {});
        }
        if (this.device.opened) {
          await this.device.close().catch(() => {});
        }
      } finally {
        this.device = null;
        this.interfaceNumber = null;
        this.endpointNumber = null;
      }
    }
  }
}
