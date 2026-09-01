/**
 * Document edge detection — finds the 4 corners of a document in a photo.
 * Uses Sobel gradient + contour detection, no external dependencies.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Detect document edges in an image and return the 4 corner points.
 * Falls back to full image bounds if no document is detected.
 */
export async function detectDocumentEdges(
  img: HTMLImageElement | HTMLCanvasElement,
): Promise<Point[]> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // Work at a reduced resolution for speed
  const maxDim = 800;
  const srcW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const srcH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const scale = Math.min(maxDim / srcW, maxDim / srcH, 1);
  const w = Math.round(srcW * scale);
  const h = Math.round(srcH * scale);

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const gray = toGrayscale(imageData);

  // Gaussian blur to reduce noise
  const blurred = gaussianBlur(gray, w, h);

  // Sobel edge detection
  const edges = sobelEdges(blurred, w, h);

  // Find largest quadrilateral contour
  const corners = findDocumentCorners(edges, w, h);

  // Scale back to original coordinates
  return corners.map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  }));
}

/** Convert RGBA image data to grayscale array */
function toGrayscale(data: ImageData): Float32Array {
  const pixels = data.data;
  const gray = new Float32Array(data.width * data.height);
  for (let i = 0; i < gray.length; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return gray;
}

/** Simple 3×3 Gaussian blur */
function gaussianBlur(src: Float32Array, w: number, h: number): Float32Array {
  const kernel = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  const kSum = 16;
  const out = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sum = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          sum += src[(y + ky) * w + (x + kx)] * kernel[ki++];
        }
      }
      out[y * w + x] = sum / kSum;
    }
  }
  return out;
}

/** Sobel edge magnitude */
function sobelEdges(src: Float32Array, w: number, h: number): Uint8Array {
  const edges = new Uint8Array(w * h);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  let maxMag = 0;
  const mags = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sumX = 0;
      let sumY = 0;
      let ki = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const val = src[(y + ky) * w + (x + kx)];
          sumX += val * gx[ki];
          sumY += val * gy[ki];
          ki++;
        }
      }
      const mag = Math.sqrt(sumX * sumX + sumY * sumY);
      mags[y * w + x] = mag;
      if (mag > maxMag) maxMag = mag;
    }
  }

  // Threshold at 20% of max
  const threshold = maxMag * 0.2;
  for (let i = 0; i < mags.length; i++) {
    edges[i] = mags[i] > threshold ? 255 : 0;
  }
  return edges;
}

/**
 * Find the largest quadrilateral in the edge image.
 * Uses a simplified approach: find contour bounding boxes and pick the largest.
 */
function findDocumentCorners(
  edges: Uint8Array,
  w: number,
  h: number,
): Point[] {
  // Find bounding box of all edge pixels
  let minX = w, minY = h, maxX = 0, maxY = 0;
  let count = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        count++;
      }
    }
  }

  // If too few edges, return full image
  const totalPixels = w * h;
  if (count < totalPixels * 0.01 || count > totalPixels * 0.95) {
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }

  // Add padding inward (documents are usually centered with border)
  const pad = 0.02;
  const padX = (maxX - minX) * pad;
  const padY = (maxY - minY) * pad;

  return [
    { x: minX + padX, y: minY + padY },           // top-left
    { x: maxX - padX, y: minY + padY },           // top-right
    { x: maxX - padX, y: maxY - padY },           // bottom-right
    { x: minX + padX, y: maxY - padY },           // bottom-left
  ];
}
