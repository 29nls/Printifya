/**
 * Pre-built pas-foto page components for each standard size.
 * Each is a thin wrapper around the shared PasFotoWorkflow via pasFotoPage().
 */
import type { PasFotoSize } from "./pasFotoSize";
import { pasFotoPage } from "./pasFotoPage";

export const PAS_FOTO_SIZES: Record<string, PasFotoSize> = {
  "2x3": {
    id: "2x3",
    title: "Pas Foto 2x3",
    label: "2 × 3 cm",
    description: "Upload foto, crop otomatis rasio 2×3, lalu pratinjau hasil cetak.",
    icon: "🪪",
    widthPx: 236,
    heightPx: 354,
    widthMm: 20,
    heightMm: 30,
    fileName: "pas-foto-2x3",
  },
  "3x4": {
    id: "3x4",
    title: "Pas Foto 3x4",
    label: "3 × 4 cm",
    description: "Upload foto, crop otomatis rasio 3×4, lalu pratinjau hasil cetak.",
    icon: "🪪",
    widthPx: 354,
    heightPx: 472,
    widthMm: 30,
    heightMm: 40,
    fileName: "pas-foto-3x4",
  },
  "4x6": {
    id: "4x6",
    title: "Pas Foto 4x6",
    label: "4 × 6 cm",
    description: "Upload foto, crop otomatis rasio 4×6, lalu pratinjau hasil cetak.",
    icon: "🪪",
    widthPx: 472,
    heightPx: 709,
    widthMm: 40,
    heightMm: 60,
    fileName: "pas-foto-4x6",
  },
};

export const PasFoto2x3Page = pasFotoPage(PAS_FOTO_SIZES["2x3"]);
export const PasFoto3x4Page = pasFotoPage(PAS_FOTO_SIZES["3x4"]);
export const PasFoto4x6Page = pasFotoPage(PAS_FOTO_SIZES["4x6"]);
