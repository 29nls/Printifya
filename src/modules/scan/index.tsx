import { useRef, useState, useCallback } from "react";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { detectDocumentEdges } from "./edgeDetect";
import { perspectiveTransform } from "./perspective";
import { enhanceDocument } from "./enhance";
import "./style.css";

type Step = "capture" | "crop" | "enhance" | "done";

export default function ScanPage() {
  const [step, setStep] = useState<Step>("capture");
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [enhanceMode, setEnhanceMode] = useState<"color" | "bw" | "gray">("color");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Capture from camera */
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
      if (photo.dataUrl) {
        setOriginalUrl(photo.dataUrl);
        setStep("crop");
        await processImage(photo.dataUrl);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("User cancelled")) return;
      setError("Gagal mengakses kamera. Coba upload foto.");
    }
  };

  /** Pick from gallery */
  const pickFromGallery = async () => {
    setError("");
    try {
      const photo = await Camera.getPhoto({
        quality: 95,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        width: 2400,
      });
      if (photo.dataUrl) {
        setOriginalUrl(photo.dataUrl);
        setStep("crop");
        await processImage(photo.dataUrl);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("User cancelled")) return;
      setError("Gagal membuka galeri.");
    }
  };

  /** Handle file upload (web fallback) */
  const handleFile = async (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("File harus berupa gambar.");
      return;
    }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    setStep("crop");
    await processImage(url);
  };

  /** Process: detect edges → perspective transform → enhance */
  const processImage = async (url: string) => {
    setProcessing(true);
    setError("");
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Gagal memuat gambar"));
        img.src = url;
      });

      // Step 1: Detect document edges
      const corners = await detectDocumentEdges(img);

      // Step 2: Perspective transform to straighten
      const straightened = perspectiveTransform(img, corners as [typeof corners[0], typeof corners[1], typeof corners[2], typeof corners[3]]);

      // Step 3: Enhance
      const enhanced = enhanceDocument(straightened, { mode: "color", contrast: 1.2, sharpen: true });

      setProcessedUrl(straightened.toDataURL("image/png"));
      setEnhancedUrl(enhanced.toDataURL("image/png"));
      setStep("enhance");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses gambar");
    } finally {
      setProcessing(false);
    }
  };

  /** Re-enhance with different mode */
  const applyEnhance = useCallback(async () => {
    if (!processedUrl) return;
    setProcessing(true);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = processedUrl;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const enhanced = enhanceDocument(canvas, { mode: enhanceMode, contrast: 1.2, sharpen: true });
      setEnhancedUrl(enhanced.toDataURL("image/png"));
    } finally {
      setProcessing(false);
    }
  }, [processedUrl, enhanceMode]);

  /** Re-enhance when mode changes */
  const handleModeChange = (mode: "color" | "bw" | "gray") => {
    setEnhanceMode(mode);
    applyEnhance();
  };

  /** Download result */
  const download = () => {
    if (!enhancedUrl) return;
    const a = document.createElement("a");
    a.href = enhancedUrl;
    a.download = "scan-hasil.png";
    a.click();
  };

  /** Export to PDF */
  const exportPdf = async () => {
    if (!enhancedUrl) return;
    setProcessing(true);
    try {
      const { default: jsPDF } = await import("jspdf");
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = enhancedUrl;
      });

      // A4 size in mm
      const pdfW = 210;
      const pdfH = 297;
      const margin = 10;
      const usableW = pdfW - margin * 2;
      const usableH = pdfH - margin * 2;

      const imgRatio = img.naturalWidth / img.naturalHeight;
      const pdfRatio = usableW / usableH;

      let drawW: number, drawH: number;
      if (imgRatio > pdfRatio) {
        drawW = usableW;
        drawH = usableW / imgRatio;
      } else {
        drawH = usableH;
        drawW = usableH * imgRatio;
      }

      const pdf = new jsPDF("p", "mm", "a4");
      const x = margin + (usableW - drawW) / 2;
      const y = margin + (usableH - drawH) / 2;
      pdf.addImage(enhancedUrl, "PNG", x, y, drawW, drawH);
      pdf.save("scan-hasil.pdf");
    } catch {
      setError("Gagal membuat PDF");
    } finally {
      setProcessing(false);
    }
  };

  /** Reset to start */
  const reset = () => {
    setOriginalUrl(null);
    setProcessedUrl(null);
    setEnhancedUrl(null);
    setStep("capture");
    setError("");
    setEnhanceMode("color");
  };

  return (
    <div className="scan-page">
      <header className="module-header">
        <span className="module-icon">📷</span>
        <div>
          <h1>Scan & Digitize</h1>
          <p>Foto dokumen → detect tepi → luruskan → bersihkan → simpan PDF</p>
        </div>
      </header>

      {/* Step 1: Capture */}
      {step === "capture" && (
        <section className="panel">
          <div className="scan-capture-grid">
            {Capacitor.isNativePlatform() ? (
              <>
                <button type="button" className="scan-capture-btn" onClick={captureFromCamera}>
                  <span className="scan-capture-icon">📸</span>
                  <span className="scan-capture-label">Ambil Foto</span>
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
                <h3>Seret & letakkan foto dokumen</h3>
                <p>atau klik untuk memilih file — JPG, PNG</p>
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
      )}

      {/* Processing */}
      {processing && (
        <div className="scan-processing">
          <span className="spinner" />
          <p>Memproses dokumen…</p>
        </div>
      )}

      {/* Step 2: Enhance */}
      {step === "enhance" && enhancedUrl && !processing && (
        <div className="scan-result">
          <div className="scan-preview-row">
            {originalUrl && (
              <div className="scan-preview-card">
                <span className="scan-preview-label">Asli</span>
                <img src={originalUrl} alt="Asli" className="scan-preview-img" />
              </div>
            )}
            {processedUrl && (
              <div className="scan-preview-card">
                <span className="scan-preview-label">Luruskan</span>
                <img src={processedUrl} alt="Luruskan" className="scan-preview-img" />
              </div>
            )}
            <div className="scan-preview-card scan-preview-active">
              <span className="scan-preview-label">Hasil</span>
              <img src={enhancedUrl} alt="Hasil" className="scan-preview-img" />
            </div>
          </div>

          <div className="panel">
            <h2>Pengaturan</h2>
            <div className="scan-options">
              <label className="scan-mode-label">Mode:</label>
              <div className="scan-mode-group">
                {(["color", "gray", "bw"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`chip ${m === enhanceMode ? "active" : ""}`}
                    onClick={() => handleModeChange(m)}
                  >
                    {m === "color" ? "🎨 Warna" : m === "gray" ? "⬛ Grayscale" : "⬜ Hitam-Putih"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scan-actions">
            <button type="button" className="btn" onClick={reset}>
              🔄 Scan Ulang
            </button>
            <button type="button" className="btn" onClick={download}>
              ⬇️ Unduh PNG
            </button>
            <button type="button" className="btn btn-primary" onClick={exportPdf}>
              📄 Ekspor PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
