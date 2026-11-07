/**
 * Driver Web Bluetooth (BLE) untuk thermal / mobile printer ESC/POS.
 * Mendukung pairing BLE device, penemuan GATT service/characteristic (Serial Port Profile / Printer UUIDs),
 * pemecahan chunk MTU (chunking 20-512 byte), graceful disconnect, dan status fallback.
 */

// UUID standar yang lazim digunakan printer thermal BLE (misal: POS58, PeriPage, MPT-II, generic BLE serial)
export const KNOWN_BLE_PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // Standar printer service
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Seri POS/Thermal
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC Transparent / BLE serial
  "0000ff00-0000-1000-8000-00805f9b34fb", // Custom 0xFF00
  "0000fee7-0000-1000-8000-00805f9b34fb", // Custom 0xFEE7
];

export const KNOWN_BLE_PRINTER_CHARACTERISTICS = [
  "00002af1-0000-1000-8000-00805f9b34fb", // Standar printer write
  "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
  "49535343-8841-43f4-a8d4-ecbe34729bb3", // ISSC Write
  "0000ff02-0000-1000-8000-00805f9b34fb", // 0xFF02 write
  "0000ff01-0000-1000-8000-00805f9b34fb", // 0xFF01 write
];

export interface BleDeviceMinimal {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<GattServerMinimal>;
    disconnect: () => void;
  };
  addEventListener?: (type: string, listener: (ev: Event) => void) => void;
  removeEventListener?: (type: string, listener: (ev: Event) => void) => void;
}

export interface GattServerMinimal {
  connected: boolean;
  disconnect: () => void;
  getPrimaryServices: () => Promise<GattServiceMinimal[]>;
  getPrimaryService: (service: string) => Promise<GattServiceMinimal>;
}

export interface GattServiceMinimal {
  uuid: string;
  getCharacteristics: () => Promise<GattCharacteristicMinimal[]>;
  getCharacteristic: (characteristic: string) => Promise<GattCharacteristicMinimal>;
}

export interface GattCharacteristicMinimal {
  uuid: string;
  properties?: {
    write?: boolean;
    writeWithoutResponse?: boolean;
  };
  writeValue?: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
}

export interface MinimalBluetoothNavigator {
  requestDevice: (options: {
    acceptAllDevices?: boolean;
    filters?: Array<{ services?: string[]; name?: string; namePrefix?: string }>;
    optionalServices?: string[];
  }) => Promise<BleDeviceMinimal>;
}

export interface BlePrinterResult {
  ok: boolean;
  message: string;
  bytesWritten?: number;
}

export class BlePrinterDriver {
  private device: BleDeviceMinimal | null = null;
  private server: GattServerMinimal | null = null;
  private writeCharacteristic: GattCharacteristicMinimal | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor(
    private readonly customBluetooth?: MinimalBluetoothNavigator
  ) {}

  private get bluetooth(): MinimalBluetoothNavigator | undefined {
    if (this.customBluetooth) return this.customBluetooth;
    if (typeof navigator !== "undefined" && "bluetooth" in navigator) {
      return (navigator as unknown as { bluetooth: MinimalBluetoothNavigator }).bluetooth;
    }
    return undefined;
  }

  isSupported(): boolean {
    return Boolean(this.bluetooth && typeof this.bluetooth.requestDevice === "function");
  }

  isConnected(): boolean {
    return Boolean(this.device && this.server && this.server.connected && this.writeCharacteristic);
  }

  getConnectedDeviceName(): string | null {
    return this.device?.name || (this.device ? "BLE Printer (Tanpa Nama)" : null);
  }

  onDisconnect(cb: () => void): void {
    this.onDisconnectCallback = cb;
  }

  private handleGattDisconnected = (): void => {
    this.server = null;
    this.writeCharacteristic = null;
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  };

  /**
   * Membuka picker native browser untuk memilih perangkat BLE Printer
   */
  async requestAndConnect(): Promise<BlePrinterResult> {
    if (!this.isSupported()) {
      return {
        ok: false,
        message: "Web Bluetooth API tidak didukung pada browser ini. Pastikan menggunakan Chrome/Edge dengan flag Bluetooth aktif.",
      };
    }

    try {
      const device = await this.bluetooth!.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_BLE_PRINTER_SERVICES,
      });

      this.device = device;
      if (this.device.addEventListener) {
        this.device.addEventListener("gattserverdisconnected", this.handleGattDisconnected);
      }

      if (!device.gatt) {
        return {
          ok: false,
          message: "GATT Server tidak tersedia pada perangkat BLE ini.",
        };
      }

      const server = await device.gatt.connect();
      this.server = server;

      // Cari service & characteristic untuk menulis data cetak
      const characteristic = await this.findWriteCharacteristic(server);
      if (!characteristic) {
        this.disconnect();
        return {
          ok: false,
          message: "Tidak ditemukan karakteristik GATT yang mendukung penulisan (write) pada printer BLE ini.",
        };
      }

      this.writeCharacteristic = characteristic;
      return {
        ok: true,
        message: `Terhubung ke printer BLE: ${device.name || "Perangkat BLE"}`,
      };
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "NotFoundError") {
        return { ok: false, message: "Pemilihan perangkat Bluetooth dibatalkan pengguna." };
      }
      if (error.name === "SecurityError") {
        return { ok: false, message: "Akses Bluetooth ditolak oleh izin browser/keamanan." };
      }
      return {
        ok: false,
        message: `Gagal menghubungkan printer BLE: ${error.message || String(err)}`,
      };
    }
  }

  private async findWriteCharacteristic(
    server: GattServerMinimal
  ): Promise<GattCharacteristicMinimal | null> {
    // 1. Coba service yang sudah dikenal
    for (const serviceUuid of KNOWN_BLE_PRINTER_SERVICES) {
      try {
        const service = await server.getPrimaryService(serviceUuid);
        const chars = await service.getCharacteristics();
        for (const c of chars) {
          if (
            KNOWN_BLE_PRINTER_CHARACTERISTICS.includes(c.uuid.toLowerCase()) ||
            c.properties?.write ||
            c.properties?.writeWithoutResponse
          ) {
            return c;
          }
        }
      } catch {
        // Abaikan jika service tidak ada pada perangkat ini
      }
    }

    // 2. Fallback: inspect seluruh primary services jika didukung
    try {
      if (typeof server.getPrimaryServices === "function") {
        const services = await server.getPrimaryServices();
        for (const service of services) {
          const chars = await service.getCharacteristics();
          for (const c of chars) {
            if (c.properties?.write || c.properties?.writeWithoutResponse) {
              return c;
            }
          }
        }
      }
    } catch {
      // Abaikan error enumerate services
    }

    return null;
  }

  /**
   * Mengirim data ESC/POS dengan pemecahan ukuran chunk (chunking)
   * Standar MTU aman BLE: 20-100 byte per paket agar tidak terjadi buffer overflow pada printer.
   */
  async print(data: Uint8Array, chunkSize: number = 64): Promise<BlePrinterResult> {
    if (!this.isConnected() || !this.writeCharacteristic) {
      return {
        ok: false,
        message: "Printer BLE belum terhubung. Silakan hubungkan perangkat terlebih dahulu.",
      };
    }

    try {
      let offset = 0;
      let bytesSent = 0;

      while (offset < data.length) {
        const end = Math.min(offset + chunkSize, data.length);
        const chunk = data.slice(offset, end);
        const buffer = chunk.buffer as ArrayBuffer;

        if (this.writeCharacteristic.writeValueWithoutResponse) {
          await this.writeCharacteristic.writeValueWithoutResponse(buffer);
        } else if (this.writeCharacteristic.writeValue) {
          await this.writeCharacteristic.writeValue(buffer);
        } else {
          throw new Error("Karakteristik BLE tidak menyediakan metode penulisan nilai.");
        }

        bytesSent += chunk.length;
        offset = end;
        // Jeda kecil (10ms) per chunk untuk mencegah overrun buffer chip Bluetooth
        if (offset < data.length) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      return {
        ok: true,
        message: `Berhasil mengirim ${bytesSent} byte data ESC/POS ke printer BLE.`,
        bytesWritten: bytesSent,
      };
    } catch (err: unknown) {
      const error = err as Error;
      return {
        ok: false,
        message: `Gagal mengirim data cetak ke printer BLE: ${error.message || String(err)}`,
      };
    }
  }

  disconnect(): void {
    try {
      if (this.server && this.server.connected) {
        this.server.disconnect();
      }
    } catch {
      // Abaikan error penutupan
    } finally {
      this.server = null;
      this.writeCharacteristic = null;
      this.device = null;
      if (this.onDisconnectCallback) {
        this.onDisconnectCallback();
      }
    }
  }
}
