import { ModulePage } from "../../../components/ModulePage";

export default function PasFoto4x6Page() {
  return (
    <ModulePage
      icon="🪪"
      title="Pas Foto 4x6"
      description="Siapkan dan cetak pas foto ukuran standar 4×6 cm dengan rasio crop otomatis."
      features={[
        "Unggah foto (drag & drop atau pilih file)",
        "Crop dengan rasio tetap 4×6 (472×709 px @ 300 DPI)",
        "Template cetak banyak salinan per halaman A4",
        "Pratinjau cetak dengan margin dan orientasi kertas",
        "Opsi watermark / teks logo studio",
      ]}
    />
  );
}
