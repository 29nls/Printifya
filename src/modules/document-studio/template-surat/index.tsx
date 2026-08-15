import { ModulePage } from "../../../components/ModulePage";

export default function TemplateSuratPage() {
  return (
    <ModulePage
      icon="✉️"
      title="Template Surat"
      description="Kumpulan template surat resmi (dinas, undangan, lamaran) yang bisa diisi dan dicetak."
      features={[
        "Template: surat dinas, undangan, lamaran kerja, surat keterangan",
        "Kop surat dan logo instansi",
        "Kolom isian otomatis (nama, tanggal, no. surat)",
        "Ekspor ke DOCX / PDF",
        "Cetak dengan kop dan nomor halaman",
      ]}
    />
  );
}
