import PasFotoWorkflow from "../shared/PasFotoWorkflow";
import type { PasFotoSize } from "../shared/pasFotoSize";

const SIZE: PasFotoSize = {
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
};

export default function PasFoto2x3Page() {
  return <PasFotoWorkflow size={SIZE} />;
}
