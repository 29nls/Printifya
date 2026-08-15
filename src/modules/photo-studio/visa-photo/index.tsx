import PasFotoWorkflow from "../shared/PasFotoWorkflow";
import type { PasFotoSize } from "../shared/pasFotoSize";

/** Preset pas foto visa berbagai negara (dimensi @ 300 DPI). */
const VISA_PRESETS: PasFotoSize[] = [
  {
    id: "schengen",
    title: "Schengen",
    label: "35 × 45 mm",
    description: "Visa Schengen (UE).",
    icon: "🇪🇺",
    widthPx: 413,
    heightPx: 531,
    widthMm: 35,
    heightMm: 45,
    fileName: "visa-schengen",
    note: "Latar polos terang (putih / abu-abu muda). Kepala 32–36 mm dari dagu ke ubun-ubun, wajah menghadap kamera, ekspresi netral.",
  },
  {
    id: "amerika-serikat",
    title: "Amerika Serikat",
    label: "2 × 2 in",
    description: "Visa & paspor AS.",
    icon: "🇺🇸",
    widthPx: 600,
    heightPx: 600,
    widthMm: 51,
    heightMm: 51,
    fileName: "visa-amerika-serikat",
    note: "Latar putih polos. Wajah menghadap kamera, mata terbuka, tanpa kacamata berbingkai tebal; kepala 25–35 mm dari dagu ke ubun-ubun.",
  },
  {
    id: "inggris",
    title: "Inggris",
    label: "35 × 45 mm",
    description: "Visa Inggris (UK).",
    icon: "🇬🇧",
    widthPx: 413,
    heightPx: 531,
    widthMm: 35,
    heightMm: 45,
    fileName: "visa-inggris",
    note: "Latar krem / abu-abu polos. Kepala 29–34 mm, tanpa kilap, ekspresi netral, tidak memakai seragam.",
  },
  {
    id: "kanada",
    title: "Kanada",
    label: "35 × 45 mm",
    description: "Visa Kanada.",
    icon: "🇨🇦",
    widthPx: 413,
    heightPx: 531,
    widthMm: 35,
    heightMm: 45,
    fileName: "visa-kanada",
    note: "Latar putih polos. Kepala 25–35 mm, wajah menghadap kamera, ekspresi netral.",
  },
  {
    id: "australia",
    title: "Australia",
    label: "35 × 45 mm",
    description: "Visa Australia.",
    icon: "🇦🇺",
    widthPx: 413,
    heightPx: 531,
    widthMm: 35,
    heightMm: 45,
    fileName: "visa-australia",
    note: "Latar polos terang. Kepala 32–36 mm, tanpa aksesori yang menutupi wajah.",
  },
  {
    id: "jepang",
    title: "Jepang",
    label: "45 × 45 mm",
    description: "Visa Jepang.",
    icon: "🇯🇵",
    widthPx: 531,
    heightPx: 531,
    widthMm: 45,
    heightMm: 45,
    fileName: "visa-jepang",
    note: "Latar polos (putih / abu-abu / biru muda). Wajah menghadap kamera, ekspresi netral, tanpa topi.",
  },
  {
    id: "tiongkok",
    title: "Tiongkok",
    label: "33 × 48 mm",
    description: "Visa Tiongkok.",
    icon: "🇨🇳",
    widthPx: 390,
    heightPx: 567,
    widthMm: 33,
    heightMm: 48,
    fileName: "visa-tiongkok",
    note: "Latar putih polos. Kepala sekitar 70–80% tinggi foto, wajah menghadap kamera, tanpa topi.",
  },
  {
    id: "indonesia",
    title: "Indonesia",
    label: "4 × 6 cm",
    description: "Paspor Indonesia.",
    icon: "🇮🇩",
    widthPx: 472,
    heightPx: 709,
    widthMm: 40,
    heightMm: 60,
    fileName: "visa-indonesia",
    note: "Latar putih polos untuk paspor. Wajah menghadap kamera, kedua telinga terlihat jelas.",
  },
];

export default function VisaPhotoPage() {
  return (
    <PasFotoWorkflow
      size={VISA_PRESETS[0]}
      presets={VISA_PRESETS}
      header={{
        title: "Visa Photo",
        description:
          "Pas foto sesuai ketentuan visa berbagai negara — pilih negara, aturannya otomatis diterapkan.",
        icon: "🌍",
      }}
    />
  );
}
