import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BlePrinterDriver,
  type MinimalBluetoothNavigator,
  type BleDeviceMinimal,
  type GattServerMinimal,
  type GattServiceMinimal,
  type GattCharacteristicMinimal,
} from "./blePrinter";

describe("BlePrinterDriver", () => {
  let mockChar: GattCharacteristicMinimal;
  let mockService: GattServiceMinimal;
  let mockServer: GattServerMinimal;
  let mockDevice: BleDeviceMinimal;
  let mockBluetooth: MinimalBluetoothNavigator;

  beforeEach(() => {
    mockChar = {
      uuid: "0000ff02-0000-1000-8000-00805f9b34fb",
      properties: { write: true },
      writeValue: vi.fn(async () => {}),
      writeValueWithoutResponse: vi.fn(async () => {}),
    };

    mockService = {
      uuid: "0000ff00-0000-1000-8000-00805f9b34fb",
      getCharacteristics: vi.fn(async () => [mockChar]),
      getCharacteristic: vi.fn(async () => mockChar),
    };

    mockServer = {
      connected: true,
      disconnect: vi.fn(),
      getPrimaryService: vi.fn(async () => mockService),
      getPrimaryServices: vi.fn(async () => [mockService]),
    };

    mockDevice = {
      id: "ble-printer-001",
      name: "RPP02N Thermal Printer",
      gatt: {
        connected: true,
        connect: vi.fn(async () => mockServer),
        disconnect: vi.fn(),
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    mockBluetooth = {
      requestDevice: vi.fn(async () => mockDevice),
    };
  });

  it("mendeteksi ketersediaan Web Bluetooth API", () => {
    const driverSupported = new BlePrinterDriver(mockBluetooth);
    expect(driverSupported.isSupported()).toBe(true);

    const driverUnsupported = new BlePrinterDriver(undefined);
    expect(driverUnsupported.isSupported()).toBe(false);
  });

  it("melakukan requestDevice, connect GATT server, dan menemukan karakteristik penulisan", async () => {
    const driver = new BlePrinterDriver(mockBluetooth);
    const connRes = await driver.requestAndConnect();

    expect(connRes.ok).toBe(true);
    expect(connRes.message).toContain("RPP02N Thermal Printer");
    expect(driver.isConnected()).toBe(true);
    expect(driver.getConnectedDeviceName()).toBe("RPP02N Thermal Printer");
  });

  it("menangani pembatalan requestDevice atau penolakan izin secara graceful", async () => {
    const cancelBluetooth: MinimalBluetoothNavigator = {
      requestDevice: vi.fn(async () => {
        const err = new Error("User cancelled");
        err.name = "NotFoundError";
        throw err;
      }),
    };

    const driver = new BlePrinterDriver(cancelBluetooth);
    const res = await driver.requestAndConnect();

    expect(res.ok).toBe(false);
    expect(res.message).toContain("dibatalkan pengguna");
    expect(driver.isConnected()).toBe(false);
  });

  it("melakukan transfer chunked ESC/POS data dengan chunk size yang aman", async () => {
    const driver = new BlePrinterDriver(mockBluetooth);
    await driver.requestAndConnect();

    // Buat data biner ESC/POS sebesar 130 byte (akan dipecah menjadi 3 chunk: 64, 64, 2 byte)
    const data = new Uint8Array(130);
    data[0] = 0x1b; // ESC
    data[1] = 0x40; // @ (Init)

    const printRes = await driver.print(data, 64);

    expect(printRes.ok).toBe(true);
    expect(printRes.bytesWritten).toBe(130);
    expect(mockChar.writeValueWithoutResponse).toHaveBeenCalledTimes(3);
  });

  it("dapat memutus koneksi secara manual dan memanggil callback onDisconnect", async () => {
    const driver = new BlePrinterDriver(mockBluetooth);
    await driver.requestAndConnect();

    const onDisconnect = vi.fn();
    driver.onDisconnect(onDisconnect);

    driver.disconnect();
    expect(driver.isConnected()).toBe(false);
    expect(mockServer.disconnect).toHaveBeenCalled();
    expect(onDisconnect).toHaveBeenCalled();
  });
});
