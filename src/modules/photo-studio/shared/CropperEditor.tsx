import { useEffect, useRef, useState } from "react";
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import type { PasFotoSize } from "./pasFotoSize";
import { detectFace } from "./faceDetect";

interface CropperEditorProps {
  size: PasFotoSize;
  src: string;
  fileName: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}

/**
 * Editor crop menggunakan Cropper.js dengan rasio terkunci sesuai ukuran pas foto.
 * Saat "Terapkan", hasil di-render ulang ke resolusi cetak (px @ 300 DPI).
 */
export default function CropperEditor({
  size,
  src,
  fileName,
  onCancel,
  onApply,
}: CropperEditorProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const cropperRef = useRef<Cropper | null>(null);
  const [faceStatus, setFaceStatus] = useState<"idle" | "found" | "none">("idle");

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;

    let cropper: Cropper | null = null;
    const init = () => {
      cropperRef.current?.destroy();
      cropper = new Cropper(img, {
        aspectRatio: size.widthPx / size.heightPx,
        viewMode: 1,
        autoCropArea: 0.9,
        background: false,
        guides: true,
        center: true,
        checkOrientation: true,
        modal: true,
        ready: runFaceDetection,
      });
      cropperRef.current = cropper;
    };

    if (img.complete) init();
    else img.addEventListener("load", init);

    return () => {
      img.removeEventListener("load", init);
      cropperRef.current?.destroy();
      cropperRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, size]);

  /**
   * Deteksi wajah lalu arahkan kotak crop ke wajah dengan framing pas foto
   * (wajah ±60% tinggi foto, mata di ±40% dari atas).
   */
  const runFaceDetection = () => {
    const cropper = cropperRef.current;
    const img = imgRef.current;
    if (!cropper || !img) return;

    const face = detectFace(img);
    if (!face) {
      setFaceStatus("none");
      return;
    }
    setFaceStatus("found");

    const aspect = size.widthPx / size.heightPx;

    // Perkiraan tinggi kepala = kulit terdeteksi + ruang rambut di atasnya (±20%).
    const headH = face.h * 1.2;
    const cropHNorm = headH / 0.6; // kepala ≈ 60% tinggi foto
    const faceCX = face.x + face.w / 2;
    const faceCY = face.y + face.h * 0.35; // area mata di sepertiga atas kulit

    // Koordinat crop box berada dalam ruang piksel natural gambar (container
    // cropper hanya diskalakan via CSS transform), jadi pakai naturalWidth/Height.
    const height = cropHNorm * img.naturalHeight;
    const width = height * aspect;

    cropper.setData({
      x: Math.max(0, faceCX * img.naturalWidth - width / 2),
      y: Math.max(0, faceCY * img.naturalHeight - 0.4 * height),
      width,
      height,
    });
  };

  const apply = () => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const canvas = cropper.getCroppedCanvas({
      width: size.widthPx,
      height: size.heightPx,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high",
    });
    onApply(canvas.toDataURL("image/png"));
  };

  const run = (fn: (c: Cropper) => void) => () => {
    cropperRef.current && fn(cropperRef.current);
  };

  return (
    <div className="cropper-editor">
      <div className="cropper-shell">
        <img ref={imgRef} src={src} alt={fileName} />
      </div>

      <div className="cropper-toolbar">
        <button type="button" className="btn" onClick={runFaceDetection}>
          🎯 Deteksi Wajah
        </button>
        <button type="button" className="btn" onClick={run((c) => c.zoom(0.1))}>
          🔍 Perbesar
        </button>
        <button type="button" className="btn" onClick={run((c) => c.zoom(-0.1))}>
          🔎 Perkecil
        </button>
        <button type="button" className="btn" onClick={run((c) => c.rotate(-90))}>
          ⟲ Putar Kiri
        </button>
        <button type="button" className="btn" onClick={run((c) => c.rotate(90))}>
          ⟳ Putar Kanan
        </button>
        <button type="button" className="btn" onClick={run((c) => c.reset())}>
          ↺ Reset
        </button>
        <span className="ratio-badge">Rasio terkunci {size.label}</span>
        {faceStatus === "found" && (
          <span className="face-badge found">🎯 Wajah terdeteksi</span>
        )}
        {faceStatus === "none" && (
          <span className="face-badge">Wajah tidak terdeteksi</span>
        )}
      </div>

      <div className="cropper-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Batal
        </button>
        <button type="button" className="btn btn-primary" onClick={apply}>
          Terapkan Crop
        </button>
      </div>

      <p className="hint">
        Geser atau seret kotak crop untuk memilih area wajah. Hasil akhir:{" "}
        <strong>
          {size.widthPx} × {size.heightPx} px @ {size.dpi ?? 300} DPI
        </strong>{" "}
        ({size.label}).
      </p>
    </div>
  );
}
