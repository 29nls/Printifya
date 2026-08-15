import { ModulePage } from "../../../components/ModulePage";

export default function PasFoto2x3Page() {
  return (
    <ModulePage
      icon="🪪"
      title="Pas Foto 2x3"
      description="Siapkan dan cetak pas foto ukuran standar 2×3 cm dengan rasio crop otomatis."
      features={[
        "Unggah foto (drag & drop atau pilih file)",
        "Crop dengan rasio tetap 2×3 (236×354 px @ 300 DPI)",
        "Template cetak banyak salinan per halaman A4",
        "Pratinjau cetak dengan margin dan orientasi kertas",
        "Opsi watermark / teks logo studio",
      ]}
    />
  );
}
