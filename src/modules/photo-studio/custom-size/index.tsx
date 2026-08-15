import { useEffect, useMemo, useState } from "react";
import PasFotoWorkflow from "../shared/PasFotoWorkflow";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import {
  clearCustomSize,
  loadCustomSize,
  saveCustomSize,
} from "./sizeStorage";
import type { PasFotoSize } from "../shared/pasFotoSize";
import "./style.css";

const clampNum = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
};

/** Format angka cm agar rapi: 3 → "3", 2.5 → "2.5". */
const fmtCm = (n: number) => n.toFixed(2).replace(/\.?0+$/, "");

export default function CustomSizePage() {
  // Ukuran kustom — default dari localStorage, disimpan ulang setiap berubah.
  const [widthCm, setWidthCm] = useState(() => loadCustomSize().widthCm);
  const [heightCm, setHeightCm] = useState(() => loadCustomSize().heightCm);
  const [dpi, setDpi] = useState(() => loadCustomSize().dpi);

  useEffect(() => {
    saveCustomSize({ widthCm, heightCm, dpi });
  }, [widthCm, heightCm, dpi]);

  /** Reset ukuran kustom tersimpan ke default. */
  const handleResetPrefs = () => {
    clearCustomSize();
    setWidthCm(3);
    setHeightCm(4);
    setDpi(300);
  };

  const size: PasFotoSize = useMemo(
    () => ({
      id: `custom-${fmtCm(widthCm)}-${fmtCm(heightCm)}-${dpi}`,
      title: "Custom Size",
      label: `${fmtCm(widthCm)} × ${fmtCm(heightCm)} cm`,
      description: "Ukuran cetak bebas sesuai input Anda.",
      icon: "📐",
      widthPx: Math.round((widthCm / 2.54) * dpi),
      heightPx: Math.round((heightCm / 2.54) * dpi),
      widthMm: Math.round(widthCm * 10),
      heightMm: Math.round(heightCm * 10),
      dpi,
      fileName: "custom-size",
    }),
    [widthCm, heightCm, dpi]
  );

  return (
    <div>
      <header className="module-header">
        <span className="module-icon">📐</span>
        <div>
          <h1>Custom Size</h1>
          <p>
            Tentukan ukuran cetak bebas: lebar, tinggi, dan DPI — sisanya
            mengikuti alur pas foto biasa.
          </p>
        </div>
      </header>

      <section className="panel custom-config">
        <div className="custom-fields">
          <label>
            Lebar (cm)
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.1}
              value={widthCm}
              onChange={(e) => setWidthCm(clampNum(e.target.value, 0.5, 30))}
            />
          </label>
          <label>
            Tinggi (cm)
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.1}
              value={heightCm}
              onChange={(e) => setHeightCm(clampNum(e.target.value, 0.5, 30))}
            />
          </label>
          <label>
            DPI
            <input
              type="number"
              min={72}
              max={600}
              step={1}
              value={dpi}
              onChange={(e) => setDpi(clampNum(e.target.value, 72, 600))}
            />
          </label>
        </div>
        <p className="custom-summary">
          📐 Hasil:{" "}
          <strong>
            {size.widthPx} × {size.heightPx} px
          </strong>{" "}
          @ {dpi} DPI — ukuran cetak {size.label}
        </p>
        <div className="custom-reset">
          <ResetPreferencesButton
            title="Hapus lebar/tinggi/DPI tersimpan modul ini"
            onReset={handleResetPrefs}
          />
        </div>
      </section>

      <PasFotoWorkflow size={size} showHeader={false} />
    </div>
  );
}
