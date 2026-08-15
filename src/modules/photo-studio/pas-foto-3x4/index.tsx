import PasFotoWorkflow from "../shared/PasFotoWorkflow";
import type { PasFotoSize } from "../shared/pasFotoSize";

const SIZE: PasFotoSize = {
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
};

export default function PasFoto3x4Page() {
  return <PasFotoWorkflow size={SIZE} />;
}
