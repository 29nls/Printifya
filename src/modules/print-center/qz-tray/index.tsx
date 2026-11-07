import { useEffect, useRef, useState } from "react";
import {
  createQzClient,
  escposText,
  QZ_URL,
  type QzClient,
  type QzState,
} from "./qzClient";
import { WebUsbPrinterDriver } from "../webusb/webUsbPrinter";
import "../../photo-studio/shared/style.css";
import "./style.css";

export default function QzTrayPage() {
  const [status, setStatus] = useState<QzState>("idle");
  const [statusMsg, setStatusMsg] = useState("Belum terhubung ke QZ Tray.");
  const [printers, setPrinters] = useState<string[]>([]);
  const [printer, setPrinter] = useState("");
  const [testText, setTestText] = useState("Halo dari Printifya — tes cetak QZ Tray.");
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logsRef = useRef<string[]>([]);

  // State WebUSB Direct Driver
  const usbDriverRef = useRef<WebUsbPrinterDriver>(new WebUsbPrinterDriver());
  const [usbConnected, setUsbConnected] = useState(false);
  const [usbDeviceName, setUsbDeviceName] = useState<string | null>(null);
  const [usbStatusMsg, setUsbStatusMsg] = useState("");
  const isUsbSupported = usbDriverRef.current.isSupported();

  const addLog = (msg: string) => {
    const next = [...logsRef.current, `${new Date().toLocaleTimeString("id-ID")} ${msg}`].slice(-40);
    logsRef.current = next;
    setLogs(next);
  };

  // Satu sesi klien QZ Tray untuk seluruh umur komponen.
  const clientRef = useRef<QzClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createQzClient({
      onState: (s, m) => {
        setStatus(s);
        setStatusMsg(m);
      },
      onLog: addLog,
      onPrinters: (list) => {
        setPrinters(list);
        setPrinter((prev) => (list.includes(prev) ? prev : list[0] ?? ""));
      },
    });
  }
  const client = clientRef.current;

  useEffect(() => () => client.disconnect(), [client]);

  const refreshPrinters = async () => {
    setBusy(true);
    try {
      const list = await client.listPrinters();
      if (list.length > 0) setPrinter((prev) => (list.includes(prev) ? prev : list[0]));
    } finally {
      setBusy(false);
    }
  };

  const testPrint = async () => {
    if (!client.isOpen()) {
      setStatusMsg("Belum terhubung ke QZ Tray.");
      return;
    }
    if (!printer) {
      setStatusMsg("Tidak ada printer yang dipilih. Muat ulang daftar printer.");
      return;
    }
    setBusy(true);
    try {
      await client.printRaw(printer, escposText("PRINTIFYA - QZ Tray", testText || "tes"));
      setStatusMsg(`Job cetak terkirim ke ${printer}.`);
    } catch (e) {
      setStatusMsg(`Cetak gagal: ${e instanceof Error ? e.message : "lihat log"}`);
    } finally {
      setBusy(false);
    }
  };

  /** Hubungkan printer USB langsung via WebUSB */
  const handleConnectUsb = async () => {
    setBusy(true);
    setUsbStatusMsg("Membuka dialog perizinan WebUSB…");
    try {
      const res = await usbDriverRef.current.requestAndConnect();
      setUsbStatusMsg(res.message);
      if (res.ok) {
        setUsbConnected(true);
        const info = usbDriverRef.current.getDeviceInfo();
        setUsbDeviceName(info?.productName || "USB Receipt Printer");
        addLog(`[WebUSB] ${res.message}`);
      } else {
        setUsbConnected(false);
        setUsbDeviceName(null);
        addLog(`[WebUSB Error] ${res.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectUsb = async () => {
    await usbDriverRef.current.disconnect();
    setUsbConnected(false);
    setUsbDeviceName(null);
    setUsbStatusMsg("Koneksi USB diputus.");
    addLog("[WebUSB] Perangkat USB diputus.");
  };

  const handleTestPrintUsb = async () => {
    if (!usbConnected) return;
    setBusy(true);
    try {
      // Decode ESC/POS base64 ke bytes
      const base64 = escposText("PRINTIFYA - WEBUSB", testText || "Tes Cetak WebUSB");
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const res = await usbDriverRef.current.printRaw(bytes);
      setUsbStatusMsg(res.message);
      addLog(`[WebUSB] ${res.message}`);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setUsbStatusMsg(`Gagal cetak USB: ${err}`);
      addLog(`[WebUSB Error] ${err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qz-page">
      <header className="module-header">
        <span className="module-icon">🔌</span>
        <div>
          <h1>QZ Tray</h1>
          <p>
            Integrasi aplikasi pendamping <strong>QZ Tray</strong> untuk cetak
            raw (ESC/POS) ke printer USB/COM/jaringan lintas platform via
            WebSocket. Klien yang sama dipakai Network Printer sebagai jalur
            cetak otomatis.
          </p>
        </div>
      </header>

      <div className="qz-grid">
        <section className="panel">
          <h2>Koneksi QZ Tray</h2>
          <div className={`qz-status qz-${status}`}>
            <span className="qz-dot" />
            <div>
              <strong>
                {status === "connected"
                  ? "Terhubung"
                  : status === "connecting"
                    ? "Menghubung…"
                    : status === "error"
                      ? "Gagal"
                      : "Terputus"}
              </strong>
              <p>{statusMsg}</p>
            </div>
          </div>
          <div className="qz-actions">
            {status !== "connected" ? (
              <button type="button" className="btn btn-primary" onClick={client.connect} disabled={status === "connecting"}>
                🔌 Hubungkan
              </button>
            ) : (
              <button type="button" className="btn" onClick={client.disconnect}>
                ⏹️ Putuskan
              </button>
            )}
            <button type="button" className="btn" onClick={refreshPrinters} disabled={busy || status !== "connected"}>
              🔄 Muat Printer
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Driver WebUSB (Direct Printing)</h2>
          <div className={`qz-status ${usbConnected ? "qz-connected" : "qz-idle"}`}>
            <span className="qz-dot" />
            <div>
              <strong>
                {usbConnected ? `Terhubung: ${usbDeviceName}` : isUsbSupported ? "Siap Dipasangkan" : "Tidak Didukung"}
              </strong>
              <p>
                {usbStatusMsg ||
                  (isUsbSupported
                    ? "Hubungkan printer thermal USB langsung tanpa software tambahan."
                    : "Browser ini belum mendukung WebUSB. Gunakan Chrome/Edge atau QZ Tray.")}
              </p>
            </div>
          </div>
          <div className="qz-actions">
            {!usbConnected ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConnectUsb}
                disabled={busy || !isUsbSupported}
              >
                🔌 Sambung USB
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleTestPrintUsb}
                  disabled={busy}
                >
                  🖨️ Tes Cetak USB
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleDisconnectUsb}
                  disabled={busy}
                >
                  ⏹️ Lepas USB
                </button>
              </>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Cetak Raw (ESC/POS)</h2>
          <label className="qz-field">
            <span>Printer tujuan</span>
            <select className="tool-select" value={printer} onChange={(e) => setPrinter(e.target.value)}>
              {printers.length === 0 ? (
                <option value="">— belum ada printer —</option>
              ) : (
                printers.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))
              )}
            </select>
          </label>
          <label className="qz-field">
            <span>Teks uji</span>
            <input
              type="text"
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-primary" onClick={testPrint} disabled={busy || status !== "connected"}>
            {busy ? "Mengirim…" : "🖨️ Tes Cetak"}
          </button>
          <p className="hint">
            Tes mengirim ESC/POS: init → center → tebal → teks → umpan → potong
            sebagian (GS V). Printer non-ESC/POS mungkin mencetak data mentah.
          </p>
        </section>

        <section className="panel qz-log-panel">
          <h2>Log</h2>
          <pre className="qz-log">{logs.length ? logs.join("\n") : "(kosong)"}</pre>
          <button type="button" className="btn" onClick={() => { logsRef.current = []; setLogs([]); }}>
            🧹 Bersihkan Log
          </button>
        </section>

        <section className="panel">
          <h2>Panduan</h2>
          <ol className="qz-guide">
            <li>Unduh &amp; pasang <strong>QZ Tray</strong> dari qz.io (versi 2.x).</li>
            <li>Jalankan QZ Tray — ikon muncul di tray sistem (port <code>8181</code>).</li>
            <li>Buka <em>Manage Sites / Security</em> lalu izinkan situs ini (localhost) untuk WebSocket &amp; pencetakan.</li>
            <li>Klik <strong>Hubungkan</strong> di atas; status berubah menjadi "Terhubung".</li>
            <li>Pilih printer &amp; kirim tes cetak raw.</li>
          </ol>
          <p className="hint">
            Aplikasi ini memakai API WebSocket QZ Tray ({QZ_URL}): handshake,{" "}
            <code>findPrinters</code>/<code>findPrinter</code>, dan{" "}
            <code>print</code> (raw base64) — lewat klien bersama{" "}
            <code>qzClient.ts</code> yang juga dipakai Network Printer. Tanpa
            QZ Tray, modul ini aman terputus.
          </p>
        </section>
      </div>
    </div>
  );
}
