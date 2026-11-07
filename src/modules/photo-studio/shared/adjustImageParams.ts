/**
 * Helper manipulasi piksel warna ImageData untuk Photo Studio.
 * Mendukung penyesuaian:
 * - Kecerahan (brightness: -100 s/d +100)
 * - Kontras (contrast: -100 s/d +100)
 * - Saturasi (saturation: -100 s/d +100)
 * - Grayscale (boolean atau persentase 0 s/d 100)
 * - Tone temperatur warna (warm/cool balance: -100 s/d +100)
 */

export interface ColorFilterParams {
  brightness?: number; // -100 sampai +100 (0 = default)
  contrast?: number;   // -100 sampai +100 (0 = default)
  saturation?: number; // -100 sampai +100 (0 = default)
  grayscale?: number;  // 0 sampai 100 (0 = normal, 100 = full B&W)
  temperature?: number; // -100 (cool/biru) sampai +100 (warm/merah/kuning)
}

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Menerapkan penyesuaian parameter warna langsung ke ImageData (in-place atau clone).
 * Menghasilkan Uint8ClampedArray yang termodifikasi dengan nilai batas aman (0-255).
 */
export function applyColorFilters(
  data: Uint8ClampedArray,
  params: ColorFilterParams = {}
): Uint8ClampedArray {
  const {
    brightness = 0,
    contrast = 0,
    saturation = 0,
    grayscale = 0,
    temperature = 0,
  } = params;

  // Faktor kontras: [-100, 100] -> factor [0, ~]
  // Formula standar: factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  const cFactor =
    contrast === 0
      ? 1
      : (259 * (contrast + 255)) / (255 * (259 - Math.min(254, contrast)));

  // Faktor saturasi: [-100, 100] -> multiplier [0, 2]
  const sFactor = 1 + saturation / 100;

  // Faktor grayscale: [0, 100] -> [0, 1]
  const gRatio = Math.max(0, Math.min(100, grayscale)) / 100;

  // Offset temperatur warna
  // warm (>0): tambah merah, kurangi biru
  // cool (<0): kurangi merah, tambah biru
  const tempR = (temperature * 25) / 100;
  const tempB = (-temperature * 25) / 100;

  const len = data.length;
  for (let i = 0; i < len; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    // alpha data[i + 3] dipertahankan

    // 1. Kecerahan (Brightness)
    if (brightness !== 0) {
      const bOffset = (brightness * 255) / 100;
      r += bOffset;
      g += bOffset;
      b += bOffset;
    }

    // 2. Kontras (Contrast)
    if (contrast !== 0) {
      r = cFactor * (r - 128) + 128;
      g = cFactor * (g - 128) + 128;
      b = cFactor * (b - 128) + 128;
    }

    // 3. Temperatur (Warm/Cool)
    if (temperature !== 0) {
      r += tempR;
      b += tempB;
    }

    // 4. Saturasi (Saturation)
    // Standar Luminance Rec. 709 (0.2126*R + 0.7152*G + 0.0722*B)
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (saturation !== 0) {
      r = lum + (r - lum) * sFactor;
      g = lum + (g - lum) * sFactor;
      b = lum + (b - lum) * sFactor;
    }

    // 5. Grayscale (B&W blend)
    if (gRatio > 0) {
      r = r * (1 - gRatio) + lum * gRatio;
      g = g * (1 - gRatio) + lum * gRatio;
      b = b * (1 - gRatio) + lum * gRatio;
    }

    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }

  return data;
}

/**
 * Helper untuk menerapkan filter warna pada HTMLCanvasElement atau OffscreenCanvas
 */
export function applyFiltersToCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  params: ColorFilterParams
): void {
  const imgData = ctx.getImageData(0, 0, width, height);
  applyColorFilters(imgData.data, params);
  ctx.putImageData(imgData, 0, 0);
}
