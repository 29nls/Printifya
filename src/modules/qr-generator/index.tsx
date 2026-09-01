import { useRef, useState } from "react";
import "./style.css";

/** Simple QR Code generator using canvas — no external dependencies.
 *  Generates a QR-code-like matrix for short strings. For production,
 *  use a real QR library; this is a visual placeholder. */

type QRMode = "text" | "wifi" | "link";

export default function QRGeneratorPage() {
  const [mode, setMode] = useState<QRMode>("text");
  const [textInput, setTextInput] = useState("");
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPass, setWifiPass] = useState("");
  const [wifiHidden, setWifiHidden] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Build the QR string based on mode */
  const buildPayload = (): string => {
    switch (mode) {
      case "wifi":
        return `WIFI:T:WPA;S:${wifiSsid};P:${wifiPass};${wifiHidden ? "H:true;" : ""};`;
      case "link":
        return linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      case "text":
      default:
        return textInput;
    }
  };

  /** Generate a simple matrix pattern (visual placeholder — not a real QR).
   *  Replace with qrcode library for real QR output. */
  const generateMatrix = (payload: string): boolean[][] => {
    const size = 25; // 25×25 matrix
    const matrix: boolean[][] = Array.from({ length: size }, () =>
      new Array(size).fill(false),
    );

    // Finder patterns (top-left, top-right, bottom-left)
    const drawFinder = (r: number, c: number) => {
      for (let dr = 0; dr < 7; dr++) {
        for (let dc = 0; dc < 7; dc++) {
          const isEdge = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const isInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          matrix[r + dr][c + dc] = isEdge || isInner;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      matrix[6][i] = i % 2 === 0;
      matrix[i][6] = i % 2 === 0;
    }

    // Data encoding (simple hash-based fill)
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) - hash + payload.charCodeAt(i)) | 0;
    }

    let seed = Math.abs(hash);
    const nextRand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        // Skip finder patterns and timing
        if (
          (r < 9 && c < 9) ||
          (r < 9 && c >= size - 8) ||
          (r >= size - 8 && c < 9) ||
          r === 6 ||
          c === 6
        ) continue;

        if (!matrix[r][c]) {
          matrix[r][c] = nextRand() % 3 !== 0;
        }
      }
    }

    return matrix;
  };

  /** Draw matrix to canvas */
  const drawQR = (matrix: boolean[][]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const size = matrix.length;
    const padding = 4; // modules of quiet zone
    const moduleSize = 10;
    const totalSize = (size + padding * 2) * moduleSize;

    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext("2d")!;

    // White background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, totalSize, totalSize);

    // Draw modules
    ctx.fillStyle = "#000000";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(
            (c + padding) * moduleSize,
            (r + padding) * moduleSize,
            moduleSize,
            moduleSize,
          );
        }
      }
    }

    setQrDataUrl(canvas.toDataURL("image/png"));
  };

  const handleGenerate = () => {
    setError("");
    const payload = buildPayload();
    if (!payload.trim()) {
      setError("Masukkan data terlebih dahulu.");
      return;
    }
    const matrix = generateMatrix(payload);
    drawQR(matrix);
  };

  const download = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `qrcode-${mode}.png`;
    a.click();
  };

  const printQr = () => {
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
  };

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
                onClick={() => { setMode(m.id); setQrDataUrl(null); setError(""); }}
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
              <label className="form-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={wifiHidden}
                  onChange={(e) => setWifiHidden(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: "var(--accent)" }}
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

          {error && <p className="error">{error}</p>}

          <button type="button" className="btn btn-primary" onClick={handleGenerate} style={{ marginTop: 8 }}>
            🔲 Buat QR Code
          </button>
        </div>

        <div className="qr-preview-panel">
          <canvas ref={canvasRef} style={{ display: "none" }} />
          {qrDataUrl ? (
            <>
              <img src={qrDataUrl} alt="QR Code" className="qr-preview-img" />
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
