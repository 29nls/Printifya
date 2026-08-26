/**
 * Native share utility for sharing files via Android share sheet.
 * Uses @capacitor/share for native sharing and falls back to Web Share API
 * or download for web browsers.
 */

import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { downloadUrl } from "./downloadUrl";

export interface ShareOptions {
  /** Title for the share dialog */
  title?: string;
  /** Text to accompany the shared file */
  text?: string;
  /** URL to share (optional) */
  url?: string;
}

/**
 * Convert Blob to base64 data URL for Capacitor share.
 * Required because Capacitor Share plugin needs file path or base64.
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Get MIME type from file extension
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    webm: "video/webm",
    mp4: "video/mp4",
  };
  return mimeTypes[ext ?? ""] ?? "application/octet-stream";
}

/**
 * Share a file via native share sheet (Android) or Web Share API (web).
 * Falls back to download if sharing is not available.
 *
 * @param blob - The file blob to share
 * @param filename - The filename for the shared file
 * @param options - Share options (title, text, url)
 */
export async function shareFile(
  blob: Blob,
  filename: string,
  options: ShareOptions = {}
): Promise<boolean> {
  const { title = "Printifya", text = "", url } = options;

  // Try native Capacitor share on Android/iOS
  if (Capacitor.isNativePlatform()) {
    try {
      const base64 = await blobToBase64(blob);

      await Share.share({
        title,
        text,
        url,
        files: [base64],
      });
      return true;
    } catch (error) {
      // User cancelled share or error occurred
      console.warn("Native share failed, falling back to download:", error);
      // Fall through to download fallback
    }
  }

  // Try Web Share API on supported browsers
  if (typeof navigator.share === "function") {
    try {
      const file = new File([blob], filename, { type: getMimeType(filename) });
      const shareData: ShareData = {
        title,
        text,
        files: [file],
      };

      if (navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return true;
      }
    } catch (error) {
      // User cancelled share or error occurred
      console.warn("Web Share API failed, falling back to download:", error);
      // Fall through to download fallback
    }
  }

  // Fallback to download
  const objectUrl = URL.createObjectURL(blob);
  downloadUrl(objectUrl, filename);
  return false;
}

/**
 * Share a PDF document specifically.
 * Convenience wrapper with PDF-specific defaults.
 */
export async function sharePdf(
  blob: Blob,
  filename: string,
  options: ShareOptions = {}
): Promise<boolean> {
  return shareFile(blob, filename, {
    title: "Bagikan PDF",
    text: `PDF dari ${filename}`,
    ...options,
  });
}

/**
 * Share a photo/image.
 * Convenience wrapper with image-specific defaults.
 */
export async function sharePhoto(
  blob: Blob,
  filename: string,
  options: ShareOptions = {}
): Promise<boolean> {
  return shareFile(blob, filename, {
    title: "Bagikan Foto",
    text: "Foto dari Printifya",
    ...options,
  });
}

/**
 * Check if native sharing is available on this platform.
 */
export function isNativeShareAvailable(): boolean {
  return Capacitor.isNativePlatform() || typeof navigator.share === "function";
}
