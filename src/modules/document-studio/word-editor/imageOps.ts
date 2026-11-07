/**
 * imageOps.ts
 *
 * Helper untuk pemrosesan, kompresi, dan pembentukan tag HTML gambar/watermark
 * di Word Editor. Menjaga ukuran gambar di bawah batas aman agar tidak membebani
 * local storage dan riwayat cetak.
 */

export const IMAGE_MAX_SIDE = 800;
export const IMAGE_JPEG_QUALITY = 0.85;

export type ImageAlignment = "left" | "center" | "right";

export interface InsertImageOptions {
  src: string;
  alt?: string;
  alignment?: ImageAlignment;
  caption?: string;
  maxWidthPercent?: number;
}

/**
 * Hitung dimensi gambar agar muat dalam batas maxSide dengan rasio tetap.
 */
export function fitImageDimensions(
  width: number,
  height: number,
  maxSide = IMAGE_MAX_SIDE
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxSide) ||
    width <= 0 ||
    height <= 0 ||
    maxSide <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxSide / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Bangun markup HTML untuk menyisipkan gambar dengan perataan tertentu.
 */
export function buildImageHtml(options: InsertImageOptions): string {
  const safeSrc = options.src.trim();
  const safeAlt = (options.alt || "Gambar Dokumen")
    .replace(/[<>&"]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));
  const align = options.alignment || "center";
  const maxWidth = Math.max(10, Math.min(100, options.maxWidthPercent ?? 80));

  let containerStyle = "text-align: center; margin: 12pt 0;";
  if (align === "left") containerStyle = "text-align: left; margin: 12pt 0;";
  if (align === "right") containerStyle = "text-align: right; margin: 12pt 0;";

  const imgStyle = `max-width: ${maxWidth}%; height: auto; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.1);`;

  const captionHtml = options.caption
    ? `<div style="font-size: 9.5pt; color: #666; font-style: italic; margin-top: 4pt;">${options.caption.replace(/[<>&"]/g, "")}</div>`
    : "";

  return `<div class="doc-image-container" style="${containerStyle}"><img src="${safeSrc}" alt="${safeAlt}" style="${imgStyle}" />${captionHtml}</div><p><br></p>`;
}
