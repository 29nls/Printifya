import { useEffect, useRef, useState } from "react";
import {
  createQzClient,
  escposText,
  QZ_URL,
  type QzClient,
  type QzState,
} from "./qzClient";
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
          <h2>Koneksi</h2>
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
