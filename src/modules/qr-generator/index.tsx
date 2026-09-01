import { useRef, useState, useCallback } from "react";
import QRCode from "qrcode";
import "./style.css";

type QRMode = "text" | "wifi" | "link";
type ECLevel = "L" | "M" | "Q" | "H";

const EC_LABELS: Record<ECLevel, string> = {
  L: "Rendah (7%)",
  M: "Sedang (15%)",
  Q: "Tinggi (25%)",
  H: "Tertinggi (30%)",
};

export default function QRGeneratorPage() {
  const [mode, setMode] = useState<QRMode>("text");
  const [textInput, setTextInput] = useState("");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [wifiHidden, setWifiHidden] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [ecLevel, setEcLevel] = useState<ECLevel>("M");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const buildPayload = useCallback((): string => {
    switch (mode) {
      case "wifi":
        return `WIFI:T:WPA;S:${wifiSsid};P:${wifiPass};${wifiHidden ? "H:true;" : ""};`;
      case "link":
        return linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      case "text":
      default:
        return textInput;
    }
  }, [mode, textInput, wifiSsid, wifiPass, wifiHidden, linkUrl]);

  const handleGenerate = useCallback(async () => {
    setError("");
    const payload = buildPayload();
    if (!payload.trim()) {
      setError("Masukkan data terlebih dahulu.");
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    setGenerating(true);
    try {
      await QRCode.toCanvas(canvas, payload, {
        errorCorrectionLevel: ecLevel,
        margin: 2,
        width: 300,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      });
      setQrDataUrl(canvas.toDataURL("image/png"));
    } catch (err) {
      setError(
        err instanceof Error
          ? `Gagal membuat QR code: ${err.message}`
          : "Gagal membuat QR code."
      );
      setQrDataUrl(null);
    } finally {
      setGenerating(false);
    }
  }, [buildPayload, ecLevel]);

  const download = useCallback(() => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qrcode-${mode}.png`;
    a.click();
  }, [qrDataUrl, mode]);

  const printQr = useCallback(() => {
    if (!qrDataUrl) return;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<!DOCTYPE html><html><head><style>
        @page{size:A4;margin:20mm;}
        body{display:flex;justify-content:center;align-items:center;height:100vh;}
        img{max-width:100mm;}
      </style></head><body>
        <img src="${qrDataUrl}" />
        <script>onload=()=>{window.print();window.close();}<\/script>
      </body></html>`);
      w.document.close();
    }
  }, [qrDataUrl]);

  return (
    <div className="qr-page">
      <header className="module-header">
        <span className="module-icon">📱</span>
        <div>
          <h1>QR Code Generator</h1>
          <p>Buat QR code untuk WiFi, link, atau teks</p>
        </div>
      </header>

      <div className="qr-layout">
        <div className="panel">
          <h2>Input</h2>

          <div className="scan-mode-group" style={{ marginBottom: 14 }}>
            {([
              { id: "text" as QRMode, label: "📝 Teks" },
              { id: "wifi" as QRMode, label: "📶 WiFi" },
              { id: "link" as QRMode, label: "🔗 Link" },
            ]).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip ${mode === m.id ? "active" : ""}`}
                onClick={() => {
                  setMode(m.id);
                  setQrDataUrl(null);
                  setError("");
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "text" && (
            <label className="form-field">
              <span>Teks</span>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Masukkan teks yang ingin di-QR-kan…"
                rows={4}
              />
            </label>
          )}

          {mode === "wifi" && (
            <>
              <label className="form-field">
                <span>Nama WiFi (SSID)</span>
                <input
                  type="text"
                  value={wifiSsid}
                  onChange={(e) => setWifiSsid(e.target.value)}
                  placeholder="Nama jaringan WiFi"
                />
              </label>
              <label className="form-field">
                <span>Password</span>
                <input
                  type="text"
                  value={wifiPass}
                  onChange={(e) => setWifiPass(e.target.value)}
                  placeholder="Password WiFi"
                />
              </label>
              <label
                className="form-field"
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={wifiHidden}
                  onChange={(e) => setWifiHidden(e.target.checked)}
                  style={{
                    width: 16,
                    height: 16,
                    accentColor: "var(--accent)",
                  }}
                />
                <span>WiFi tersembunyi (hidden SSID)</span>
              </label>
            </>
          )}

          {mode === "link" && (
            <label className="form-field">
              <span>URL</span>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://contoh.com"
              />
            </label>
          )}

          {/* Error correction level */}
          <label className="form-field" style={{ marginTop: 10 }}>
            <span>Koreksi Error</span>
            <select
              value={ecLevel}
              onChange={(e) => setEcLevel(e.target.value as ECLevel)}
            >
              {(["L", "M", "Q", "H"] as ECLevel[]).map((lvl) => (
                <option key={lvl} value={lvl}>
                  {lvl} — {EC_LABELS[lvl]}
                </option>
              ))}
            </select>
          </label>

          {error && <p className="error">{error}</p>}

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
            style={{ marginTop: 8 }}
          >
            {generating ? "Membuat…" : "🔲 Buat QR Code"}
          </button>
        </div>

        <div className="qr-preview-panel">
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {qrDataUrl ? (
            <>
              <img
                src={qrDataUrl}
                alt="QR Code"
                className="qr-preview-img"
              />
              <div className="qr-actions">
                <button type="button" className="btn" onClick={download}>
                  ⬇️ Unduh PNG
                </button>
                <button type="button" className="btn" onClick={printQr}>
                  🖨️ Cetak
                </button>
              </div>
            </>
          ) : (
            <div className="qr-placeholder">
              <span style={{ fontSize: "3rem" }}>📱</span>
              <p>QR Code akan muncul di sini</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
