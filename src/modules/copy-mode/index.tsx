import { useRef, useState } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import "./style.css";

export default function CopyModePage() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [copies, setCopies] = useState(2);
  const [layout, setLayout] = useState<"grid" | "strip">("grid");
  const [paperSize, setPaperSize] = useState("A4");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const captureFromCamera = async () => {
    setError("");
    try {
      const photo = await Camera.getPhoto({
        quality: 95,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        width: 2400,
        correctOrientation: true,
      });
      if (photo.dataUrl) setOriginalUrl(photo.dataUrl);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("User cancelled")) return;
      setError("Gagal mengakses kamera.");
    }
  };

  const pickFromGallery = async () => {
    setError("");
    try {
      const photo = await Camera.getPhoto({
        quality: 95,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        width: 2400,
      });
      if (photo.dataUrl) setOriginalUrl(photo.dataUrl);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("User cancelled")) return;
      setError("Gagal membuka galeri.");
    }
  };

  const handleFile = (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar.");
      return;
    }
    setOriginalUrl(URL.createObjectURL(file));
  };

  /** Generate PDF with N copies arranged on sheets */
  const generatePdf = async () => {
    if (!originalUrl) return;
    setProcessing(true);
    setError("");
    try {
      const { default: jsPDF } = await import("jspdf");
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = originalUrl;
      });

      const pdfW = paperSize === "A4" ? 210 : paperSize === "A3" ? 297 : 210;
      const pdfH = paperSize === "A4" ? 297 : paperSize === "A3" ? 420 : 297;
      const margin = 10;
      const usableW = pdfW - margin * 2;
      const usableH = pdfH - margin * 2;

      // Calculate grid dimensions
      const imgRatio = img.naturalWidth / img.naturalHeight;
      let cols: number, rows: number;

      if (layout === "strip") {
        // Vertical strip: stack copies
        cols = 1;
        rows = copies;
      } else {
        // Grid: find best fit
        cols = Math.ceil(Math.sqrt(copies * imgRatio));
        rows = Math.ceil(copies / cols);
        // Try to fit better
        while (cols * rows < copies && cols < 6) cols++;
        rows = Math.ceil(copies / cols);
      }

      const cellW = usableW / cols;
      const cellH = usableH / rows;
      const padding = 2;

      // Fit image in cell
      let drawW: number, drawH: number;
      if (imgRatio > cellW / cellH) {
        drawW = cellW - padding * 2;
        drawH = drawW / imgRatio;
      } else {
        drawH = cellH - padding * 2;
        drawW = drawH * imgRatio;
      }

      const pdf = new jsPDF("p", "mm", paperSize);
      let count = 0;

      for (let r = 0; r < rows && count < copies; r++) {
        for (let c = 0; c < cols && count < copies; c++) {
          const x = margin + c * cellW + (cellW - drawW) / 2;
          const y = margin + r * cellH + (cellH - drawH) / 2;
          pdf.addImage(originalUrl, "PNG", x, y, drawW, drawH);
          count++;
        }
      }

      pdf.save(`fotokopi-${copies}x.pdf`);
    } catch {
      setError("Gagal membuat PDF");
    } finally {
      setProcessing(false);
    }
  };

  /** Print directly */
  const printDirect = async () => {
    if (!originalUrl) return;
    setProcessing(true);
    setError("");
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = originalUrl;
      });

      // Build HTML print template
      const imgStyle = "max-width:100%;max-height:100%;object-fit:contain;";
      const cellStyle = "display:flex;align-items:center;justify-content:center;padding:4mm;";
      let cells = "";
      for (let i = 0; i < copies; i++) {
        cells += `<div style="${cellStyle}break-inside:avoid;"><img src="${originalUrl}" style="${imgStyle}" /></div>`;
      }

      const html = `<!DOCTYPE html><html><head><style>
        @page{size:${paperSize};margin:10mm;}
        body{margin:0;}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80mm,1fr));gap:2mm;height:100vh;}
      </style></head><body><div class="grid">${cells}</div>
      <script>onload=()=>{window.print();window.close();}<\/script></body></html>`;

      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      } else {
        setError("Popup diblokir browser. Izinkan popup untuk mencetak.");
      }
    } catch {
      setError("Gagal menyiapkan cetak");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="copy-page">
      <header className="module-header">
        <span className="module-icon">📋</span>
        <div>
          <h1>Mode Fotokopi</h1>
          <p>Foto dokumen → pilih jumlah salinan → cetak langsung</p>
        </div>
      </header>

      {!originalUrl ? (
        <section className="panel">
          <div className="scan-capture-grid">
            {Capacitor.isNativePlatform() ? (
              <>
                <button type="button" className="scan-capture-btn" onClick={captureFromCamera}>
                  <span className="scan-capture-icon">📸</span>
                  <span className="scan-capture-label">Foto Dokumen</span>
                  <span className="scan-capture-hint">Dari kamera HP</span>
                </button>
                <button type="button" className="scan-capture-btn" onClick={pickFromGallery}>
                  <span className="scan-capture-icon">🖼️</span>
                  <span className="scan-capture-label">Pilih dari Galeri</span>
                  <span className="scan-capture-hint">Foto yang sudah ada</span>
                </button>
              </>
            ) : (
              <div
                className={`upload-zone ${dragOver ? "dragging" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFile(e.dataTransfer.files?.[0]);
                }}
              >
                <div className="upload-icon">📤</div>
                <h3>Seret foto dokumen di sini</h3>
                <p>atau klik untuk memilih file</p>
              </div>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      ) : (
        <div className="copy-result">
          <div className="copy-preview-area">
            <img src={originalUrl} alt="Dokumen" className="copy-preview-img" />
          </div>

          <div className="panel">
            <h2>Pengaturan Fotokopi</h2>
            <div className="copy-settings">
              <label className="copy-setting">
                <span>Jumlah Salinan</span>
                <div className="copy-counter">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCopies(Math.max(1, copies - 1))}
                    disabled={copies <= 1}
                  >
                    −
                  </button>
                  <span className="copy-count">{copies}</span>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setCopies(Math.min(20, copies + 1))}
                    disabled={copies >= 20}
                  >
                    +
                  </button>
                </div>
              </label>

              <label className="copy-setting">
                <span>Tata Letak</span>
                <div className="scan-mode-group">
                  <button
                    type="button"
                    className={`chip ${layout === "grid" ? "active" : ""}`}
                    onClick={() => setLayout("grid")}
                  >
                    🔲 Grid
                  </button>
                  <button
                    type="button"
                    className={`chip ${layout === "strip" ? "active" : ""}`}
                    onClick={() => setLayout("strip")}
                  >
                    📜 Strip
                  </button>
                </div>
              </label>

              <label className="copy-setting">
                <span>Ukuran Kertas</span>
                <select
                  className="tool-select"
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value)}
                >
                  <option value="A4">A4 (210×297 mm)</option>
                  <option value="A3">A3 (297×420 mm)</option>
                  <option value="F4">F4 (215×330 mm)</option>
                </select>
              </label>
            </div>

            {/* Preview grid */}
            <div className="copy-layout-preview">
              <span className="copy-layout-label">Pratinjau:</span>
              <div className="copy-layout-grid" data-cols={layout === "strip" ? 1 : Math.min(copies, 4)}>
                {Array.from({ length: copies }, (_, i) => (
                  <div key={i} className="copy-layout-cell">
                    {originalUrl && (
                      <img src={originalUrl} alt="" className="copy-layout-thumb" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="copy-actions">
            <button type="button" className="btn" onClick={() => { setOriginalUrl(null); setError(""); }}>
              🔄 Foto Ulang
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={generatePdf}
              disabled={processing}
            >
              {processing ? "Membuat…" : `📄 Ekspor PDF (${copies} salinan)`}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={printDirect}
              disabled={processing}
            >
              🖨️ Cetak Langsung
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
