import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { MODULES } from "../modules/registry";
import "./Home.css";

/* ── Print history (matches print-history/index.tsx storage) ──────── */

interface PrintRecord {
  id: string;
  name: string;
  copies: number;
  paperSize: string;
  timestamp: number;
  status: "done" | "failed";
}

function loadRecentHistory(limit = 5): PrintRecord[] {
  try {
    const raw = localStorage.getItem("printifya.printHistory");
    if (!raw) return [];
    const all: PrintRecord[] = JSON.parse(raw);
    return all.slice(0, limit);
  } catch {
    return [];
  }
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Baru saja";
  if (mins < 60) return `${mins} menit lalu`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} hari lalu`;
  return new Date(ts).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}

/* ── Quick actions (hardcoded top tasks) ──────────────────────────── */

const QUICK_ACTIONS = [
  {
    path: "/tools/scan",
    icon: "📷",
    title: "Scan Dokumen",
    desc: "Foto → detect tepi → PDF",
  },
  {
    path: "/photo-studio/pas-foto-3x4",
    icon: "🪪",
    title: "Pas Foto 3×4",
    desc: "Crop & cetak pas foto",
  },
  {
    path: "/tools/templates",
    icon: "📑",
    title: "Template Cepat",
    desc: "Kwitansi, surat, formulir",
  },
  {
    path: "/tools/qr",
    icon: "📱",
    title: "QR Code",
    desc: "WiFi, link, atau teks",
  },
];

/* ── Popular templates (subset for quick access) ──────────────────── */

const POPULAR_TEMPLATES = [
  { path: "/tools/templates", icon: "🧾", title: "Kwitansi" },
  { path: "/tools/templates", icon: "📝", title: "Surat Pernyataan" },
  { path: "/tools/templates", icon: "🏠", title: "Surat Domisili" },
  { path: "/tools/templates", icon: "🪪", title: "Formulir Biodata" },
];

/* ── Component ────────────────────────────────────────────────────── */

export default function Home() {
  const [recentHistory, setRecentHistory] = useState<PrintRecord[]>([]);

  useEffect(() => {
    setRecentHistory(loadRecentHistory());
  }, []);

  return (
    <div className="home">
      {/* Quick Actions */}
      <section className="home-section">
        <h2 className="home-section-title">Mulai Cepat</h2>
        <div className="quick-actions">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.path} to={a.path} className="quick-action">
              <span className="quick-action-icon">{a.icon}</span>
              <div className="quick-action-text">
                <span className="quick-action-title">{a.title}</span>
                <span className="quick-action-desc">{a.desc}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent Print History */}
      <section className="home-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Terakhir Dicetak</h2>
          {recentHistory.length > 0 && (
            <Link to="/tools/history" className="home-section-link">
              Lihat Semua →
            </Link>
          )}
        </div>

        {recentHistory.length === 0 ? (
          <div className="home-empty">
            <p>Belum ada riwayat cetak</p>
            <p className="home-empty-hint">
              Riwayat akan muncul setelah Anda mencetak dokumen.
            </p>
          </div>
        ) : (
          <div className="history-list-compact">
            {recentHistory.map((r) => (
              <div key={r.id} className="history-row">
                <span className="history-row-icon">
                  {r.status === "done" ? "✅" : "❌"}
                </span>
                <span className="history-row-name">{r.name}</span>
                <span className="history-row-meta">
                  {r.copies} lembar · {r.paperSize}
                </span>
                <span className="history-row-time">
                  {formatTimeAgo(r.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Popular Templates */}
      <section className="home-section">
        <h2 className="home-section-title">Template Populer</h2>
        <div className="popular-templates">
          {POPULAR_TEMPLATES.map((t, i) => (
            <Link
              key={`${t.path}-${i}`}
              to={t.path}
              className="popular-template"
            >
              <span className="popular-template-icon">{t.icon}</span>
              <span className="popular-template-title">{t.title}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* All Modules (compact grid) */}
      <section className="home-section">
        <h2 className="home-section-title">Semua Modul</h2>
        <div className="card-grid">
          {MODULES.map((m) => (
            <Link key={m.id} to={m.path} className="card">
              <span className="card-icon">{m.icon}</span>
              <h3>{m.title}</h3>
              <p>{m.description}</p>
              <span className="card-cta">Buka →</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
