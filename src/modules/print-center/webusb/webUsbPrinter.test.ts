import { describe, expect, it, vi } from "vitest";
import {
  WebUsbPrinterDriver,
  type MinimalUsbDevice,
  type MinimalUsbNavigator,
} from "./webUsbPrinter";

function createMockDevice(overrides: Partial<MinimalUsbDevice> = {}): MinimalUsbDevice {
  return {
    opened: false,
    vendorId: 0x04b8, // Epson vendor ID
    productId: 0x0202,
    productName: "TM-T82 Receipt Printer",
    manufacturerName: "EPSON",
    configuration: {
      interfaces: [
        {
          interfaceNumber: 0,
          alternates: [
            {
              interfaceClass: 7, // Printer Class
              endpoints: [
                { endpointNumber: 1, direction: "out", type: "bulk" },
                { endpointNumber: 2, direction: "in", type: "bulk" },
              ],
            },
          ],
        },
      ],
    },
    open: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    selectConfiguration: vi.fn(async () => {}),
    claimInterface: vi.fn(async () => {}),
    releaseInterface: vi.fn(async () => {}),
    transferOut: vi.fn(async () => ({ bytesWritten: 12, status: "ok" as const })),
    ...overrides,
  };
}

describe("WebUsbPrinterDriver", () => {
  it("mendeteksi ketiadaan dukungan WebUSB API dengan fallback pesan yang jelas", async () => {
    const driver = new WebUsbPrinterDriver(undefined);
    // Di lingkungan Node tanpa mock navigator.usb
    expect(driver.isSupported()).toBe(false);

    const res = await driver.requestAndConnect();
    expect(res.ok).toBe(false);
    expect(res.message).toContain("WebUSB API tidak didukung");
    expect(res.message).toContain("QZ Tray");
  });

  it("berhasil melakukan request, claimInterface, dan connect ke USB printer", async () => {
    const mockDev = createMockDevice();
    const mockNavigator: MinimalUsbNavigator = {
      requestDevice: vi.fn(async () => mockDev),
      getDevices: vi.fn(async () => [mockDev]),
    };

    const driver = new WebUsbPrinterDriver(mockNavigator);
    expect(driver.isSupported()).toBe(true);

    const res = await driver.requestAndConnect();
    expect(res.ok).toBe(true);
    expect(res.message).toContain("Berhasil terhubung ke USB printer");
    expect(mockDev.open).toHaveBeenCalled();
    expect(mockDev.claimInterface).toHaveBeenCalledWith(0);

    const devInfo = driver.getDeviceInfo();
    expect(devInfo?.productName).toBe("TM-T82 Receipt Printer");
    expect(devInfo?.vendorId).toBe(0x04b8);
  });

  it("menangani kegagalan claimInterface (misal batasan OS / WinUSB) dengan fallback yang ramah", async () => {
    const mockDev = createMockDevice({
      claimInterface: vi.fn(async () => {
        throw new Error("Unable to claim interface: Access denied.");
      }),
    });
    const mockNavigator: MinimalUsbNavigator = {
      requestDevice: vi.fn(async () => mockDev),
      getDevices: vi.fn(async () => [mockDev]),
    };

    const driver = new WebUsbPrinterDriver(mockNavigator);
    const res = await driver.requestAndConnect();

    expect(res.ok).toBe(false);
    expect(res.message).toContain("Akses interface USB ditolak OS");
    expect(res.message).toContain("QZ Tray");
    expect(driver.isConnected()).toBe(false);
  });

  it("mampu mengirim data printRaw saat terhubung", async () => {
    const mockDev = createMockDevice();
    const mockNavigator: MinimalUsbNavigator = {
      requestDevice: vi.fn(async () => mockDev),
      getDevices: vi.fn(async () => [mockDev]),
    };

    const driver = new WebUsbPrinterDriver(mockNavigator);
    await driver.requestAndConnect();
    mockDev.opened = true;

    const data = new Uint8Array([0x1b, 0x40, 0x0a]); // ESC @ LF
    const printRes = await driver.printRaw(data);

    expect(printRes.ok).toBe(true);
    expect(printRes.bytesWritten).toBe(12);
    expect(mockDev.transferOut).toHaveBeenCalledWith(1, data.buffer);
  });

  it("menolak printRaw jika belum terhubung", async () => {
    const driver = new WebUsbPrinterDriver();
    const res = await driver.printRaw(new Uint8Array([1, 2, 3]));
    expect(res.ok).toBe(false);
    expect(res.message).toContain("belum terhubung");
  });
});
