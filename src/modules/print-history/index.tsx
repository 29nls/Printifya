import { useState, useEffect } from "react";
import "./style.css";

interface PrintRecord {
  id: string;
  name: string;
  copies: number;
  paperSize: string;
  timestamp: number;
  status: "done" | "failed";
}

const STORAGE_KEY = "printifya.printHistory";

function loadHistory(): PrintRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(records: PrintRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const day = d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

export default function PrintHistoryPage() {
  const [history, setHistory] = useState<PrintRecord[]>([]);
  const [filter, setFilter] = useState<"all" | "done" | "failed">("all");

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
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
            Riwayat akan muncul setelah Anda mencetak dokumen dari modul Print Center atau Copy Mode.
          </p>
        </div>
      ) : (
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Helper: add a record to history (call this from print modules) */
export function addPrintRecord(name: string, copies: number, paperSize: string, status: "done" | "failed" = "done") {
  const history = loadHistory();
  history.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    copies,
    paperSize,
    timestamp: Date.now(),
    status,
  });
  // Keep last 100 records
  if (history.length > 100) history.length = 100;
  saveHistory(history);
}
