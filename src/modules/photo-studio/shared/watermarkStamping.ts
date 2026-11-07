/**
 * Helper Watermark & Metadata Stamping untuk Photo Studio Lembar Cetak.
 * Menyematkan tanda air teks / tanggal / logo studio pada sudut lembar cetak atau margin foto
 * tanpa menutupi area utama pas foto.
 */

export interface WatermarkStampOptions {
  text?: string;
  timestamp?: string; // Tanggal / waktu foto (ISO atau formatted string)
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left" | "margin-footer";
  opacity?: number;   // 0.1 s/d 1.0 (default 0.75)
  fontSize?: number;  // px (default 12)
  fontColor?: string; // CSS color string (default "rgba(0, 0, 0, 0.6)")
  padding?: number;   // px dari tepi (default 16)
}

export interface StampCoordinateResult {
  x: number;
  y: number;
  renderedText: string;
}

/**
 * Menghitung koordinat penempatan watermark pada canvas berdasarkan dimensi lembar
 */
export function calculateWatermarkCoordinates(
  width: number,
  height: number,
  text: string,
  options: WatermarkStampOptions = {}
): StampCoordinateResult {
  const {
    position = "bottom-right",
    padding = 16,
    timestamp,
  } = options;

  const renderedText = timestamp ? `${text} • ${timestamp}`.trim() : text;

  let x = padding;
  let y = padding;

  switch (position) {
    case "top-left":
      x = padding;
      y = padding;
      break;
    case "top-right":
      x = width - padding;
      y = padding;
      break;
    case "bottom-left":
      x = padding;
      y = height - padding;
      break;
    case "margin-footer":
      x = width / 2;
      y = height - padding;
      break;
    case "bottom-right":
    default:
      x = width - padding;
      y = height - padding;
      break;
  }

  return { x, y, renderedText };
}

/**
 * Merender watermark ke mock/real Canvas 2D context
 */
export function stampWatermarkOnCanvas(
  ctx: {
    save: () => void;
    restore: () => void;
    fillText: (text: string, x: number, y: number) => void;
    font: string;
    fillStyle: string;
    textAlign: "left" | "right" | "center" | "start" | "end";
    textBaseline: "top" | "hanging" | "middle" | "alphabetic" | "ideographic" | "bottom";
    globalAlpha: number;
  },
  width: number,
  height: number,
  options: WatermarkStampOptions
): StampCoordinateResult {
  const {
    text = "Printifya Studio",
    opacity = 0.7,
    fontSize = 12,
    fontColor = "#333333",
    position = "bottom-right",
    padding = 16,
  } = options;

  const coords = calculateWatermarkCoordinates(width, height, text, options);

  ctx.save();
  ctx.globalAlpha = Math.max(0.05, Math.min(1.0, opacity));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.fillStyle = fontColor;

  if (position === "bottom-right" || position === "top-right") {
    ctx.textAlign = "right";
  } else if (position === "margin-footer") {
    ctx.textAlign = "center";
  } else {
    ctx.textAlign = "left";
  }

  if (position.startsWith("bottom") || position === "margin-footer") {
    ctx.textBaseline = "bottom";
  } else {
    ctx.textBaseline = "top";
  }

  ctx.fillText(coords.renderedText, coords.x, coords.y);
  ctx.restore();

  return coords;
}
