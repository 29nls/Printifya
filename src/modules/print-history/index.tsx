import { useState } from "react";
import { printHtmlSheet } from "../print-center/printer-lokal/printHtml";
import {
  loadPrintHistory,
  loadReprintHtml,
  recordPrint,
  savePrintHistory,
  type PrintHistoryLoad,
  type PrintRecord,
} from "./printHistoryStorage";
import "./style.css";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** Pesan kondisi data tersimpan (dihitung sekali saat mount). */
function describeLoad(load: PrintHistoryLoad): string {
  if (load.locked) {
    return "Riwayat dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi sebelum menghapusnya agar data tidak tertimpa.";
  }
  if (load.unreadable) {
    return "Riwayat tersimpan tidak dapat dibaca sehingga tidak dimuat.";
  }
  if (load.dropped > 0) {
    return `${load.dropped} entri riwayat rusak dilewati.`;
  }
  return "";
}

export default function PrintHistoryPage() {
  // Dibaca sekali saat mount; hasilnya juga membawa flag kunci (data versi
  // lebih baru), entri rusak yang dilewati, dan entri yang bisa dicetak ulang.
  const [load] = useState(loadPrintHistory);
  const [history, setHistory] = useState<PrintRecord[]>(load.records);
  const [reprintable, setReprintable] = useState(
    () => new Set(load.reprintable)
  );
  const [notice, setNotice] = useState(() => describeLoad(load));
  const [filter, setFilter] = useState<"all" | "done" | "failed">("all");

  const clearHistory = () => {
    if (load.locked) {
      setNotice(
        "Riwayat dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi sebelum menghapusnya."
      );
      return;
    }
    const result = savePrintHistory([]);
    if (!result.ok) {
      // Jangan kosongkan tampilan sebelum tulis benar-benar berhasil: kalau
      // tidak, riwayat kembali saat modul dibuka ulang.
      setNotice(
        result.reason === "quota"
          ? "Riwayat tidak bisa dihapus: penyimpanan perangkat penuh."
          : "Riwayat tidak bisa dihapus: penyimpanan tidak tersedia atau diblokir."
      );
      return;
    }
    setHistory([]);
    setReprintable(new Set());
    setNotice("");
  };

  /** Cetak ulang hasil cetak yang tersimpan, lalu catat sebagai aksi baru. */
  const reprint = (record: PrintRecord) => {
    const html = loadReprintHtml(record);
    if (html === null) {
      setNotice(
        "Hasil cetak entri ini tidak tersimpan, jadi tidak bisa dicetak ulang."
      );
      return;
    }
    if (!printHtmlSheet(html)) {
      setNotice("Tidak bisa membuka dialog cetak di browser ini.");
      return;
    }
    // Cetak ulang adalah aksi cetak baru, jadi entrinya bertambah. Isi yang
    // sama memakai blob yang sudah ada, sehingga penyimpanan tidak bertambah.
    recordPrint({
      name: record.name,
      paperSize: record.paperSize,
      copies: record.copies,
      ok: true,
      html,
    });
    const fresh = loadPrintHistory();
    setHistory(fresh.records);
    setReprintable(new Set(fresh.reprintable));
    setNotice("");
  };

  const filtered = history.filter((r) => filter === "all" || r.status === filter);
  const totalSheets = history.reduce((sum, r) => sum + r.copies, 0);
  const totalDocs = history.length;
  const todayDocs = history.filter(
    (r) => new Date(r.timestamp).toDateString() === new Date().toDateString(),
  );
  const todaySheets = todayDocs.reduce((sum, r) => sum + r.copies, 0);

  return (
    <div className="history-page">
      <header className="module-header">
        <span className="module-icon">📊</span>
        <div>
          <h1>Riwayat Cetak</h1>
          <p>Lihat riwayat dokumen yang sudah dicetak</p>
        </div>
      </header>

      {/* Stats */}
      <div className="history-stats">
        <div className="history-stat">
          <span className="history-stat-value">{totalDocs}</span>
          <span className="history-stat-label">Total Dokumen</span>
        </div>
        <div className="history-stat">
          <span className="history-stat-value">{totalSheets}</span>
          <span className="history-stat-label">Total Lembar</span>
        </div>
        <div className="history-stat">
          <span className="history-stat-value">{todayDocs.length}</span>
          <span className="history-stat-label">Hari Ini</span>
        </div>
        <div className="history-stat">
          <span className="history-stat-value">{todaySheets}</span>
          <span className="history-stat-label">Lembar Hari Ini</span>
        </div>
      </div>

      {notice && <p className="error history-notice">{notice}</p>}

      {/* Filters */}
      <div className="history-toolbar">
        <div className="scan-mode-group">
          {([
            { id: "all" as const, label: "Semua" },
            { id: "done" as const, label: "✅ Berhasil" },
            { id: "failed" as const, label: "❌ Gagal" },
          ]).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chip ${filter === f.id ? "active" : ""}`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        {history.length > 0 && (
          <button type="button" className="btn" onClick={clearHistory}>
            🗑️ Hapus Semua
          </button>
        )}
      </div>

      {/* History List */}
      {filtered.length === 0 ? (
        <div className="history-empty">
          <span style={{ fontSize: "2.5rem" }}>📋</span>
          <p>Belum ada riwayat cetak</p>
          <p className="history-empty-hint">
            Riwayat akan muncul setelah Anda menekan tombol Cetak di modul mana
            pun: Pas Foto, Surat, Word Editor, Excel, Auto Layout, Printer Lokal,
            PDF Export, atau Network Printer.
          </p>
        </div>
      ) : (
        <>
          <div className="history-list">
            {filtered.map((record) => (
              <div key={record.id} className="history-item">
                <div className="history-item-icon">
                  {record.status === "done" ? "✅" : "❌"}
                </div>
                <div className="history-item-info">
                  <span className="history-item-name">{record.name}</span>
                  <span className="history-item-meta">
                    {record.copies} lembar · {record.paperSize} · {formatTime(record.timestamp)}
                  </span>
                </div>
                {reprintable.has(record.id) && (
                  <button
                    type="button"
                    className="btn history-reprint"
                    title="Cetak lagi dengan hasil yang sama"
                    onClick={() => reprint(record)}
                  >
                    🖨️
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="history-hint">
            Entri dengan tombol 🖨️ bisa dicetak ulang persis seperti hasil
            sebelumnya. Hasil cetak yang memuat foto terlalu besar untuk
            disimpan, jadi entri itu tidak punya tombol cetak ulang.
          </p>
        </>
      )}
    </div>
  );
}
