/**
 * Perspective transform — straightens a document from 4 corner points.
 * Uses canvas 2D matrix transform (no WebGL needed).
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Apply perspective transform to straighten a document.
 * Returns a canvas with the straightened document.
 */
export function perspectiveTransform(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: [Point, Point, Point, Point], // TL, TR, BR, BL
  outputWidth?: number,
  outputHeight?: number,
): HTMLCanvasElement {
  const [tl, tr, br, bl] = corners;

  // Calculate output dimensions from the top edge and left edge
  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = outputWidth ?? Math.round(Math.max(widthTop, widthBottom));
  const outH = outputHeight ?? Math.round(Math.max(heightLeft, heightRight));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;

  // Use canvas path transform to map the quadrilateral to a rectangle
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(outW, 0);
  ctx.lineTo(outW, outH);
  ctx.lineTo(0, outH);
  ctx.closePath();
  ctx.clip();

  // Draw with bilinear interpolation via multiple triangles
  drawPerspectiveQuad(ctx, source, corners, outW, outH);

  ctx.restore();
  return canvas;
}

/**
 * Draw a perspective-corrected image using two triangles.
 * This is a simple bilinear approximation that works well for documents.
 */
function drawPerspectiveQuad(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  outW: number,
  outH: number,
): void {
  const [tl, tr, br, bl] = corners;

  // Triangle 1: TL → TR → BL
  drawPerspectiveTriangle(
    ctx, source,
    tl, tr, bl,
    { x: 0, y: 0 }, { x: outW, y: 0 }, { x: 0, y: outH },
  );

  // Triangle 2: TR → BR → BL
  drawPerspectiveTriangle(
    ctx, source,
    tr, br, bl,
    { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH },
  );
}

/**
 * Map a point from output space to source space using bilinear interpolation.
 */
function bilinearMap(
  px: number, py: number,
  srcCorners: [Point, Point, Point, Point],
  outW: number, outH: number,
): Point {
  const [tl, tr, br, bl] = srcCorners;

  // Normalized coordinates
  const u = px / outW;
  const v = py / outH;

  // Bilinear interpolation
  const topX = tl.x + (tr.x - tl.x) * u;
  const topY = tl.y + (tr.y - tl.y) * u;
  const botX = bl.x + (br.x - bl.x) * u;
  const botY = bl.y + (br.y - bl.y) * u;

  return {
    x: topX + (botX - topX) * v,
    y: topY + (botY - topY) * v,
  };
}

/**
 * Draw a single triangle with perspective correction.
 */
function drawPerspectiveTriangle(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  s1: Point, s2: Point, s3: Point,
  d1: Point, d2: Point, d3: Point,
): void {
  // Create a temporary canvas for the source triangle
  const srcCanvas = document.createElement("canvas");
  const srcCtx = srcCanvas.getContext("2d")!;

  // Find bounding box of source triangle
  const minX = Math.min(s1.x, s2.x, s3.x);
  const minY = Math.min(s1.y, s2.y, s3.y);
  const maxX = Math.max(s1.x, s2.x, s3.x);
  const maxY = Math.max(s1.y, s2.y, s3.y);
  const sw = Math.ceil(maxX - minX);
  const sh = Math.ceil(maxY - minY);

  srcCanvas.width = sw;
  srcCanvas.height = sh;
  srcCtx.drawImage(source, -minX, -minY);

  // Draw using affine approximation (good enough for documents)
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.lineTo(d3.x, d3.y);
  ctx.closePath();
  ctx.clip();

  ctx.setTransform(
    (d2.x - d1.x) / sw, (d2.y - d1.y) / sh,
    (d3.x - d1.x) / sw, (d3.y - d1.y) / sh,
    d1.x, d1.y,
  );

  ctx.drawImage(srcCanvas, 0, 0, sw, sh);
  ctx.restore();
}

/**
 * Simple perspective transform using iterative subdivision.
 * Higher quality than affine but slower.
 */
export function perspectiveTransformHQ(
  source: HTMLImageElement | HTMLCanvasElement,
  corners: [Point, Point, Point, Point],
  outputWidth?: number,
  outputHeight?: number,
): HTMLCanvasElement {
  const [tl, tr, br, bl] = corners;

  const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
  const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);

  const outW = outputWidth ?? Math.round(Math.max(widthTop, widthBottom));
  const outH = outputHeight ?? Math.round(Math.max(heightLeft, heightRight));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d")!;

  // Subdivide into grid for better perspective accuracy
  const gridSize = 16;
  const cellW = outW / gridSize;
  const cellH = outH / gridSize;

  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x0 = gx * cellW;
      const y0 = gy * cellH;
      const x1 = (gx + 1) * cellW;
      const y1 = (gy + 1) * cellH;

      // Map grid corners to source coordinates
      const s00 = bilinearMap(x0, y0, corners, outW, outH);
      const s10 = bilinearMap(x1, y0, corners, outW, outH);
      const s01 = bilinearMap(x0, y1, corners, outW, outH);
      const s11 = bilinearMap(x1, y1, corners, outW, outH);

      // Draw each cell with affine approximation
      drawCell(ctx, source, s00, s10, s11, s01, x0, y0, cellW, cellH);
    }
  }

  return canvas;
}

function drawCell(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  s00: Point, s10: Point, s11: Point, s01: Point,
  dx: number, dy: number, dw: number, dh: number,
): void {
  // Source bounding box
  const minX = Math.min(s00.x, s10.x, s11.x, s01.x);
  const minY = Math.min(s00.y, s10.y, s11.y, s01.y);
  const maxX = Math.max(s00.x, s10.x, s11.x, s01.x);
  const maxY = Math.max(s00.y, s10.y, s11.y, s01.y);
  const sw = Math.ceil(maxX - minX) || 1;
  const sh = Math.ceil(maxY - minY) || 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();

  ctx.setTransform(
    (s10.x - s00.x) / dw, (s10.y - s00.y) / dh,
    (s01.x - s00.x) / dw, (s01.y - s00.y) / dh,
    s00.x - minX, s00.y - minY,
  );

  ctx.drawImage(source, minX, minY, sw, sh, 0, 0, dw, dh);
  ctx.restore();
}
