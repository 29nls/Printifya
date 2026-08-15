import { useEffect, useRef } from "react";
import { FRAMES, getFrame } from "./frames";

interface FramePickerProps {
  value: string; // id bingkai; "" = tanpa bingkai
  onChange: (id: string) => void;
}

/** Foto demo untuk pratinjau bingkai (gradien + siluet). */
const DEMO_W = 108;
const DEMO_H = 144;

function drawDemo(ctx: CanvasRenderingContext2D): void {
  const g = ctx.createLinearGradient(0, 0, DEMO_W, DEMO_H);
  g.addColorStop(0, "#7fb3e8");
  g.addColorStop(0.55, "#d9e6f5");
  g.addColorStop(1, "#c9d6e2");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, DEMO_W, DEMO_H);
  // siluet sederhana (kepala + bahu)
  ctx.fillStyle = "#3a4a5c";
  ctx.beginPath();
  ctx.arc(DEMO_W / 2, DEMO_H * 0.36, DEMO_H * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(DEMO_W / 2, DEMO_H * 1.02, DEMO_W * 0.42, DEMO_H * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Pemilih bingkai photobox: dropdown ber-grup per kategori (Klasik, Polaroid,
 * Vintage, Festif, Modern) + pratinjau mini live yang menggambar foto demo
 * dengan bingkai terpilih. Nilai `""` berarti tanpa bingkai.
 */
export default function FramePicker({ value, onChange }: FramePickerProps) {
  const previewRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, DEMO_W, DEMO_H);
    drawDemo(ctx);
    const frame = getFrame(value);
    if (frame) {
      try {
        frame.draw(ctx, DEMO_W, DEMO_H);
      } catch {
        // bingkai gagal — biarkan demo polos
      }
    }
  }, [value]);

  const categories = [...new Set(FRAMES.map((f) => f.category))];

  return (
    <div className="frame-picker">
      <label>
        Bingkai (photobox)
        <select
          className="tool-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Tanpa bingkai</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {FRAMES.filter((f) => f.category === cat).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <canvas
        ref={previewRef}
        width={DEMO_W}
        height={DEMO_H}
        className="frame-preview"
        title={
          value ? `Pratinjau: ${getFrame(value)?.name ?? "bingkai"}` : "Tanpa bingkai"
        }
      />
    </div>
  );
}
