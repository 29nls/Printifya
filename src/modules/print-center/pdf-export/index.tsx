import { ModulePage } from "../../../components/ModulePage";

export default function PdfExportPage() {
  return (
    <ModulePage
      icon="📦"
      title="PDF Export"
      description="Ekspor foto dan dokumen menjadi PDF siap cetak dengan pengaturan halaman lengkap."
      features={[
        "Export foto (layout template) ke PDF",
        "Export dokumen / spreadsheet ke PDF",
        "Pilihan ukuran kertas (A4, 4×6 in, dll.)",
        "Pengaturan margin dan orientasi",
        "Unduh PDF atau kirim langsung ke printer",
      ]}
    />
  );
}
