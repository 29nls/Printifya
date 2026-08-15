/**
 * Klien QZ Tray (WebSocket) yang dipakai bersama oleh modul QZ Tray dan
 * Network Printer. Protokol QZ 2.x: handshake `{"qz-tray","v1.0","1.0.0",
 * "beta"}` lalu panggilan `findPrinters`/`findPrinter` dan `print` (raw
 * base64). Tanpa QZ Tray terpasang, semua kegagalan ditangani dengan pesan
 * jelas — klien aman terputus.
 */

export const QZ_URL = "ws://localhost:8181";

export type QzState = "idle" | "connecting" | "connected" | "error";

export interface QzHandlers {
  onState: (state: QzState, message: string) => void;
  onLog: (line: string) => void;
  onPrinters: (printers: string[]) => void;
}

interface QzReply {
  id?: number;
  result?: unknown;
  error?: { message?: string; code?: number };
}

/** Bungkus satu panggilan QZ Tray dengan id dan timeout. */
function qzCall(
  ws: WebSocket,
  method: string,
  params: unknown,
  id: number,
  timeoutMs = 8000
): Promise<QzReply> {
  return new Promise((resolve, reject) => {
    const handler = (ev: MessageEvent) => {
      let msg: QzReply;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      if (msg.error) reject(new Error(msg.error.message ?? "Error QZ Tray"));
      else resolve(msg);
    };
    const timer = setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("Timeout menunggu balasan QZ Tray."));
    }, timeoutMs);
    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ method, params, id }));
  });
}

/** Bangun data ESC/POS (base64): init, center, tebal, teks, umpan, potong. */
export function escposText(header: string, text: string): string {
  const bytes = [
    0x1b, 0x40, // ESC @ (init)
    0x1b, 0x61, 0x01, // ESC a 1 (center)
    0x1b, 0x45, 0x01, // ESC E 1 (bold on)
    ...new TextEncoder().encode(`${header}\n`),
    0x1b, 0x45, 0x00, // bold off
    ...new TextEncoder().encode(`${text}\n\n`),
    0x1d, 0x56, 0x42, 0x00, // GS V B 0 (partial cut)
  ];
  return btoa(String.fromCharCode(...bytes));
}

export interface QzClient {
  connect: () => void;
  disconnect: () => void;
  isOpen: () => boolean;
  listPrinters: () => Promise<string[]>;
  printRaw: (printer: string, base64Data: string) => Promise<void>;
}

/** Buat satu sesi klien QZ Tray; panggil sekali per komponen (lewat ref). */
export function createQzClient(handlers: QzHandlers): QzClient {
  let ws: WebSocket | null = null;
  let idCounter = 0;
  let connecting = false;

  const log = (line: string) => handlers.onLog(line);

  const call = (method: string, params: unknown): Promise<QzReply> => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("QZ Tray tidak terhubung."));
    }
    return qzCall(ws, method, params, idCounter++);
  };

  function connect() {
    disconnect();
    connecting = true;
    handlers.onState("connecting", `Menghubung ke ${QZ_URL}… (pastikan QZ Tray berjalan)`);
    log(`Menghubung ke ${QZ_URL}`);
    let socket: WebSocket;
    try {
      socket = new WebSocket(QZ_URL);
    } catch (e) {
      connecting = false;
      handlers.onState("error", e instanceof Error ? e.message : "Gagal membuat WebSocket.");
      return;
    }
    ws = socket;

    socket.onopen = () => {
      log("Koneksi terbuka — handshake.");
      socket.send(JSON.stringify({ "qz-tray": "v1.0", "1.0.0": "beta" }));
    };

    socket.onmessage = (ev) => {
      const raw = String(ev.data);
      log(`← ${raw.slice(0, 120)}`);
      let msg: unknown;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const m = msg as Record<string, unknown>;
      if (m.version && m.product) {
        connecting = false;
        handlers.onState(
          "connected",
          `Terhubung ke QZ Tray v${String(m.version)} (${String(m.product)}).`
        );
        log("Handshake berhasil — QZ Tray siap.");
        void listPrinters();
      }
    };

    socket.onerror = () => {
      log("Error koneksi WebSocket.");
      connecting = false;
      handlers.onState(
        "error",
        "Gagal terhubung. Pastikan QZ Tray berjalan (lihat panduan)."
      );
    };

    socket.onclose = () => {
      if (ws !== socket) return; // ditutup manual via disconnect()
      log("Koneksi ditutup.");
      connecting = false;
      handlers.onState("idle", "Koneksi ditutup. Klik 'Hubungkan' untuk mencoba lagi.");
    };

    // Timeout handshake.
    setTimeout(() => {
      if (ws === socket && connecting) {
        socket.close();
        connecting = false;
        handlers.onState(
          "error",
          "Tidak ada balasan handshake — QZ Tray tidak aktif atau port 8181 terblokir."
        );
      }
    }, 6000);
  }

  function disconnect() {
    const socket = ws;
    ws = null;
    connecting = false;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* abaikan */
      }
    }
  }

  function isOpen(): boolean {
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  async function listPrinters(): Promise<string[]> {
    try {
      const reply = await call("findPrinters", {});
      const list = (reply.result as unknown[])?.map((p) => String(p)).sort() ?? [];
      log(`Ditemukan ${list.length} printer.`);
      if (list.length === 0) log("findPrinters kosong — coba findPrinter.");
      if (list.length > 0) handlers.onPrinters(list);
      return list;
    } catch (e) {
      log(`findPrinters gagal: ${e instanceof Error ? e.message : e}`);
      // Fallback: printer default.
      try {
        const reply = await call("findPrinter", {});
        const name = String(reply.result ?? "");
        if (name) {
          handlers.onPrinters([name]);
          log(`findPrinter → ${name}`);
          return [name];
        }
      } catch (e2) {
        log(`findPrinter gagal: ${e2 instanceof Error ? e2.message : e2}`);
      }
      return [];
    }
  }

  async function printRaw(printer: string, base64Data: string): Promise<void> {
    const reply = await call("print", {
      printer,
      data: [{ type: "raw", format: "base64", data: base64Data }],
      options: {},
    });
    log(`Cetak ke "${printer}" berhasil.`);
    void reply;
  }

  return { connect, disconnect, isOpen, listPrinters, printRaw };
}
