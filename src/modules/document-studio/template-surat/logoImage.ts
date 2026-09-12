/**
 * Downscale logo instansi sebelum disimpan sebagai data URL.
 *
 * Data URL logo disimpan di draf DAN digandakan ke setiap entri riwayat surat,
 * jadi satu logo multi-megabyte bisa menghabiskan kuota localStorage (~5 MB
 * dibagi bersama 21 kunci). Sebelum ini berkas dibaca apa adanya lewat
 * `readAsDataURL`, sehingga penulisan riwayat gagal secara senyap.
 *
 * Unggahan karena itu dibatasi: sisi terpanjang ≤`LOGO_MAX_SIDE` px dan
 * di-encode ulang sebagai JPEG (≈40–80 KB), jauh di bawah ambang migrasi
 * `MAX_LOGO_CHARS` di `storage.ts`.
 *
 * JPEG tidak mendukung transparansi, jadi kanvas diisi putih lebih dulu —
 * logo berlatar transparan akan menjadi hitam tanpa langkah ini, dan surat
 * memang dicetak di kertas putih.
 */

/** Sisi terpanjang maksimum logo yang disimpan (px). */
export const LOGO_MAX_SIDE = 512;
/** Kualitas JPEG hasil encode ulang. */
export const LOGO_JPEG_QUALITY = 0.85;

/**
 * Dimensi tujuan yang muat dalam `maxSide` dengan rasio dipertahankan.
 * Gambar yang sudah lebih kecil tidak diperbesar. Dimensi tak valid
 * mengembalikan 0x0 supaya pemanggil bisa menolak berkasnya.
 */
export function fitWithin(
  width: number,
  height: number,
  maxSide = LOGO_MAX_SIDE
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

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Gagal membaca berkas logo."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar logo."));
    img.src = src;
  });
}

/**
 * Baca berkas gambar, downscale, dan kembalikan data URL JPEG berukuran
 * terbatas. Melempar bila berkas tidak bisa dibaca/didecode atau dimensinya
 * tidak terbaca — pemanggil menampilkan pesan error.
 */
export async function downscaleLogo(file: File): Promise<string> {
  const source = await readAsDataUrl(file);
  const img = await loadImage(source);
  const target = fitWithin(img.naturalWidth, img.naturalHeight);
  if (target.width === 0 || target.height === 0) {
    throw new Error("Dimensi gambar logo tidak terbaca.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia.");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.drawImage(img, 0, 0, target.width, target.height);

  return canvas.toDataURL("image/jpeg", LOGO_JPEG_QUALITY);
}
