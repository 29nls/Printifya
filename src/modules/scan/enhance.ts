/**
 * Document enhancement — makes scanned documents look clean and crisp.
 * Adaptive thresholding, contrast boost, sharpening.
 */

/**
 * Apply document enhancement to make text sharp and background white.
 */
export function enhanceDocument(
  source: HTMLCanvasElement,
  options: {
    mode?: "color" | "bw" | "gray";
    contrast?: number; // 0-2, default 1.2
    sharpen?: boolean;
  } = {},
): HTMLCanvasElement {
  const { mode = "color", contrast = 1.2, sharpen = true } = options;

  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;

  // Draw source
  ctx.drawImage(source, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (mode === "bw") {
    adaptiveThreshold(imageData);
  } else if (mode === "gray") {
    toGrayscale(imageData);
    adjustContrast(imageData, contrast);
  } else {
    adjustContrast(imageData, contrast);
    adjustBrightness(imageData, 1.1);
  }

  if (sharpen) {
    sharpenImage(imageData, canvas.width, canvas.height);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Convert to grayscale */
function toGrayscale(data: ImageData): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    pixels[i] = pixels[i + 1] = pixels[i + 2] = gray;
  }
}

/** Adaptive threshold using local mean */
function adaptiveThreshold(data: ImageData): void {
  const { width, height, data: pixels } = data;

  // First convert to grayscale
  toGrayscale(data);

  // Calculate integral image for fast local mean
  const gray = new Float32Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = pixels[i * 4];
  }

  const blockSize = Math.max(15, Math.round(Math.min(width, height) / 30));
  const C = 10; // constant subtracted from mean

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      const half = Math.floor(blockSize / 2);

      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            sum += gray[ny * width + nx];
            count++;
          }
        }
      }

      const mean = sum / count;
      const idx = (y * width + x) * 4;
      const val = gray[y * width + x] > mean - C ? 255 : 0;
      pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = val;
    }
  }
}

/** Adjust contrast (1.0 = no change, >1 = more contrast) */
function adjustContrast(data: ImageData, factor: number): void {
  const pixels = data.data;
  const f = (259 * (factor * 128 + 255)) / (255 * (259 - factor * 128));

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = clamp(f * (pixels[i] - 128) + 128);
    pixels[i + 1] = clamp(f * (pixels[i + 1] - 128) + 128);
    pixels[i + 2] = clamp(f * (pixels[i + 2] - 128) + 128);
  }
}

/** Adjust brightness (1.0 = no change, >1 = brighter) */
function adjustBrightness(data: ImageData, factor: number): void {
  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = clamp(pixels[i] * factor);
    pixels[i + 1] = clamp(pixels[i + 1] * factor);
    pixels[i + 2] = clamp(pixels[i + 2] * factor);
  }
}

/** Unsharp mask sharpening */
function sharpenImage(data: ImageData, w: number, h: number): void {
  const pixels = data.data;
  const original = new Uint8ClampedArray(pixels);

  // 3×3 unsharp mask kernel
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            sum += original[((y + ky) * w + (x + kx)) * 4 + c] * kernel[ki++];
          }
        }
        pixels[(y * w + x) * 4 + c] = clamp(sum);
      }
    }
  }
}

function clamp(val: number): number {
  return Math.max(0, Math.min(255, Math.round(val)));
}
