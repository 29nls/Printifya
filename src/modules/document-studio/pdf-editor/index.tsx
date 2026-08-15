import { ModulePage } from "../../../components/ModulePage";

export default function PdfEditorPage() {
  return (
    <ModulePage
      icon="📄"
      title="PDF Editor"
      description="Lihat, gabung, pisah, dan siapkan dokumen PDF untuk dicetak."
      features={[
        "Pratinjau halaman PDF",
        "Gabungkan / pisahkan halaman",
        "Putar dan hapus halaman",
        "Pilih kertas, margin, dan orientasi cetak",
        "Cetak PDF langsung atau via dialog browser",
      ]}
    />
  );
}
