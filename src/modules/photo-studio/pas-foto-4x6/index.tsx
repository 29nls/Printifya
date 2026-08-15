import { useEffect, useState } from "react";
import PasFotoWorkflow from "../shared/PasFotoWorkflow";
import type { PasFotoSize } from "../shared/pasFotoSize";
import {
  clearPendingPasFoto,
  peekPendingPasFoto,
} from "../../shared/pasFotoBridge";

const SIZE: PasFotoSize = {
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
};

export default function PasFoto4x6Page() {
  // Bila datang dari modul lain (mis. Face Enhance / Background Removal),
  // langsung lanjut ke langkah crop dengan gambar tersebut. peek (bukan take)
  // agar aman terhadap double-mount React StrictMode; dihapus setelah commit.
  const [initialImage] = useState(() => peekPendingPasFoto());

  useEffect(() => {
    clearPendingPasFoto();
  }, []);

  return <PasFotoWorkflow size={SIZE} initialImage={initialImage ?? undefined} />;
}
