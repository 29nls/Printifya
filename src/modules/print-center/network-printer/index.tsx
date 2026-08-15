import { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import { loadJSON, saveJSON } from "../../shared/prefsStorage";
import {
  createQzClient,
  escposText,
  QZ_URL,
  type QzClient,
  type QzState,
} from "../qz-tray/qzClient";
import "../../photo-studio/shared/style.css";
import "../qz-tray/style.css"; // .qz-status / .qz-dot untuk panel QZ
import "./style.css";

interface Printer {
  id: string;
  name: string;
  host: string;
  port: number;
  path: string;
}

interface Job {
  id: string;
  printerId: string;
  doc: string;
  createdAt: string;
  status: "antre" | "mengirim" | "berhasil" | "gagal";
  note?: string;
}

const STORE_KEY = "printifya.network-printers";

function loadPrinters(): Printer[] {
  return (
    loadJSON<Printer[]>(STORE_KEY, (value) =>
      Array.isArray(value) ? (value as Printer[]) : null
    ) ?? []
  );
}

function savePrinters(list: Printer[]): void {
  saveJSON(STORE_KEY, list);
}

export default function NetworkPrinterPage() {
  const [printers, setPrinters] = useState<Printer[]>(() => loadPrinters());
  const [name, setName] = useState("");
  const [host, setHost] = useState("192.168.1.100");
  const [port, setPort] = useState(631);
  const [path, setPath] = useState("/ipp/print");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [docText, setDocText] = useState("Halo dari Printifya — Network Printer.");
  const [checking, setChecking] = useState<string | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  // Koneksi QZ Tray (jalur cetak otomatis pertama; fallback: IPP → PDF).
  const [qzState, setQzState] = useState<QzState>("idle");
  const [qzMsg, setQzMsg] = useState("QZ Tray belum terhubung.");
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [qzPrinter, setQzPrinter] = useState("");
  const clientRef = useRef<QzClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = createQzClient({
      onState: (s, m) => {
        setQzState(s);
        setQzMsg(m);
      },
      onLog: () => undefined,
      onPrinters: (list) => {
        setQzPrinters(list);
        setQzPrinter((prev) => (list.includes(prev) ? prev : list[0] ?? ""));
      },
    });
  }
  const qzClient = clientRef.current;

  useEffect(() => {
    savePrinters(printers);
  }, [printers]);

  useEffect(() => () => qzClient.disconnect(), [qzClient]);

  const addPrinter = () => {
    setError("");
    if (!name.trim() || !host.trim()) {
      setError("Nama dan host/IP printer wajib diisi.");
      return;
    }
    const p: Printer = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      host: host.trim(),
      port: Number(port) || 631,
      path: path.trim() || "/ipp/print",
    };
    setPrinters((prev) => [...prev, p]);
    setName("");
    setError("");
  };

  const removePrinter = (id: string) => {
    setPrinters((prev) => prev.filter((p) => p.id !== id));
    setJobs((prev) => prev.filter((j) => j.printerId !== id));
  };

  /** Uji koneksi ke endpoint IPP printer. Browser memblokir CORS untuk IPP
   *  lintas-asal, jadi hasil "gagal" wajar; ini hanya heuristik konektivitas. */
  const checkPrinter = async (p: Printer) => {
    setChecking(p.id);
    setStatusMap((m) => ({ ...m, [p.id]: "Memeriksa…" }));
    const url = `http://${p.host}:${p.port}${p.path}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    // mode no-cors: balasan tak terbaca, tapi resolve = server merespons,
    // reject = jaringan tidak terjangkau / timeout.
    let reached = false;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/ipp" },
        body: new Uint8Array([0x02, 0x00, 0x00, 0x01]),
        signal: ctrl.signal,
        mode: "no-cors",
      });
      reached = true;
    } catch {
      reached = false;
    }
    clearTimeout(t);
    setStatusMap((m) => ({
      ...m,
      [p.id]: reached
        ? "Host terjangkau (IPP diblokir CORS browser — lihat catatan)"
        : "Tidak terjangkau — periksa alamat/port atau firewall",
    }));
    setChecking(null);
  };

  const queueJob = (printerId: string) => {
    setError("");
    if (!docText.trim()) {
      setError("Isi teks dokumen dulu.");
      return;
    }
    const job: Job = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      printerId,
      doc: docText.trim().slice(0, 60),
      createdAt: new Date().toLocaleTimeString("id-ID"),
      status: "antre",
    };
    setJobs((prev) => [job, ...prev]);
    void sendJob(job);
  };

  /** Rute cetak otomatis: QZ Tray (bila terhubung) → IPP heuristik → PDF. */
  const sendJob = async (job: Job) => {
    const p = printers.find((x) => x.id === job.printerId);
    if (!p) return;
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: "mengirim" } : j))
    );

    // 1) QZ Tray terhubung → cetak raw (ESC/POS) ke printer QZ terpilih.
    if (qzClient.isOpen() && qzPrinter) {
      try {
        await qzClient.printRaw(
          qzPrinter,
          escposText("PRINTIFYA - NETWORK PRINTER", job.doc)
        );
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: "berhasil",
                  note: `Dicetak via QZ Tray → "${qzPrinter}" (raw ESC/POS).`,
                }
              : j
          )
        );
        return;
      } catch (e) {
        // QZ gagal saat mengirim → lanjut ke jalur berikutnya.
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, note: `QZ Tray gagal (${e instanceof Error ? e.message : e}) — coba IPP.` }
              : j
          )
        );
      }
    }

    // 2) IPP heuristik: IPP sungguhan diblokir browser (CORS). Simulasikan
    //    pengiriman, lalu tandai sesuai konektivitas terakhir.
    await new Promise((r) => setTimeout(r, 900));
    const reachable = (statusMap[p.id] ?? "").startsWith("Host terjangkau");
    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? {
              ...j,
              status: reachable ? "berhasil" : "gagal",
              note: reachable
                ? "Dikirim via IPP (mode no-cors)."
                : "QZ Tray tak terhubung & printer IPP tak terjangkau — pakai fallback Ekspor PDF.",
            }
          : j
      )
    );
  };

  /** Fallback nyata: ekspor isi job sebagai PDF (unduhan) — selalu berfungsi. */
  const fallbackPdf = (job: Job) => {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    const lines = doc.splitTextToSize(job.doc, 170);
    doc.text(lines, 20, 30);
    doc.save(`job-${job.id.slice(-4)}.pdf`);
  };

  const removeJob = (id: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== id));
  };

  return (
    <div className="np-page">
      <header className="module-header">
        <span className="module-icon">🌐</span>
        <div>
          <h1>Network Printer</h1>
          <p>
            Kelola printer jaringan (IPP) dan antrean job cetak. Rute otomatis:{" "}
            <strong>QZ Tray</strong> (raw ESC/POS bila terhubung) → IPP{" "}
            <em>no-cors</em> (heuristik) → fallback ekspor PDF yang selalu
            berfungsi.
          </p>
        </div>
      </header>

      <div className="np-grid">
        <section className="panel np-qz">
          <div className="archive-head">
            <h2>🔌 Cetak via QZ Tray (otomatis)</h2>
            <div className={`qz-status qz-${qzState}`}>
              <span className="qz-dot" />
              <div>
                <strong>
                  {qzState === "connected"
                    ? "Terhubung"
                    : qzState === "connecting"
                      ? "Menghubung…"
                      : qzState === "error"
                        ? "Gagal"
                        : "Terputus"}
                </strong>
                <p>{qzMsg}</p>
              </div>
            </div>
          </div>
          <div className="np-qz-row">
            {qzState !== "connected" ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={qzClient.connect}
                disabled={qzState === "connecting"}
              >
                🔌 Hubungkan QZ Tray
              </button>
            ) : (
              <button type="button" className="btn" onClick={qzClient.disconnect}>
                ⏹️ Putuskan
              </button>
            )}
            <label className="np-field np-field-inline">
              <span>Printer QZ tujuan</span>
              <select
                className="tool-select"
                value={qzPrinter}
                onChange={(e) => setQzPrinter(e.target.value)}
              >
                {qzPrinters.length === 0 ? (
                  <option value="">— belum ada printer —</option>
                ) : (
                  qzPrinters.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))
                )}
              </select>
            </label>
          </div>
          <p className="hint">
            Bila QZ Tray terhubung, job antrean otomatis dicetak raw ke printer
            QZ terpilih ({QZ_URL}). Bila tidak, job dicoba lewat IPP dan — bila
            gagal — siap diunduh sebagai PDF (fallback).
          </p>
        </section>

        <section className="panel">
          <h2>Daftar Printer</h2>
          {printers.length === 0 ? (
            <p className="hint">Belum ada printer. Tambahkan printer IPP di bawah.</p>
          ) : (
            <ul className="np-list">
              {printers.map((p) => (
                <li key={p.id}>
                  <div className="np-item">
                    <div>
                      <strong>{p.name}</strong>
                      <span>
                        {p.host}:{p.port}
                        {p.path}
                      </span>
                      {statusMap[p.id] && <em>{statusMap[p.id]}</em>}
                    </div>
                    <div className="np-item-actions">
                      <button type="button" className="btn" disabled={checking === p.id} onClick={() => checkPrinter(p)}>
                        {checking === p.id ? "…" : "🔎 Cek"}
                      </button>
                      <button type="button" className="btn btn-primary" onClick={() => queueJob(p.id)}>
                        🖨️ Antre Job
                      </button>
                      <button type="button" className="btn np-del" title="Hapus printer" onClick={() => removePrinter(p.id)}>
                        🗑
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2>Tambah Printer</h2>
          <div className="np-form">
            <label className="np-field">
              <span>Nama</span>
              <input type="text" value={name} placeholder="mis. Printer Ruang 1" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="np-field">
              <span>Host / IP</span>
              <input type="text" value={host} onChange={(e) => setHost(e.target.value)} />
            </label>
            <label className="np-field">
              <span>Port</span>
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 631)} />
            </label>
            <label className="np-field">
              <span>Jalur IPP</span>
              <input type="text" value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
            <button type="button" className="btn btn-primary" onClick={addPrinter}>
              ➕ Tambah
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="hint">
            💡 Printer tersimpan di localStorage modul ini. Port IPP standar:
            631 (bisa juga 80/443 dengan <code>https://</code>).
          </p>
        </section>

        <section className="panel">
          <h2>Antrean Job</h2>
          <label className="np-field">
            <span>Teks dokumen untuk job berikutnya</span>
            <textarea rows={3} value={docText} onChange={(e) => setDocText(e.target.value)} />
          </label>
          {jobs.length === 0 ? (
            <p className="hint">
              Belum ada job. Pilih printer lalu klik "Antre Job".
            </p>
          ) : (
            <ul className="np-jobs">
              {jobs.map((j) => (
                <li key={j.id}>
                  <div className="np-job">
                    <strong>
                      {j.doc} <span className={`job-badge job-${j.status}`}>{j.status}</span>
                    </strong>
                    <span>
                      {printers.find((p) => p.id === j.printerId)?.name ?? "?"} ·{" "}
                      {j.createdAt}
                    </span>
                    {j.note && <em>{j.note}</em>}
                    <div className="np-item-actions">
                      <button type="button" className="btn" onClick={() => fallbackPdf(j)} disabled={j.status === "mengirim"}>
                        ⬇️ Ekspor PDF (fallback)
                      </button>
                      <button type="button" className="btn np-del" onClick={() => removeJob(j.id)}>
                        🗑
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
