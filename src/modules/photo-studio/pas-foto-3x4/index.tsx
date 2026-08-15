import { ModulePage } from "../../../components/ModulePage";

export default function PasFoto3x4Page() {
  return (
    <ModulePage
      icon="🪪"
      title="Pas Foto 3x4"
      description="Siapkan dan cetak pas foto ukuran standar 3×4 cm dengan rasio crop otomatis."
      features={[
        "Unggah foto (drag & drop atau pilih file)",
        "Crop dengan rasio tetap 3×4 (354×472 px @ 300 DPI)",
        "Template cetak banyak salinan per halaman A4",
        "Pratinjau cetak dengan margin dan orientasi kertas",
        "Opsi watermark / teks logo studio",
      ]}
    />
  );
}
