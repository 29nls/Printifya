import { ModulePage } from "../../../components/ModulePage";

export default function PrinterLokalPage() {
  return (
    <ModulePage
      icon="🖨️"
      title="Printer Lokal"
      description="Cetak langsung ke printer lokal via dialog browser, WebUSB, atau Print.js."
      features={[
        "Cetak via dialog browser (window.print)",
        "Dukungan WebUSB untuk printer USB (Chrome)",
        "Fallback Print.js untuk HTML/gambar/PDF",
        "Deteksi dan penanganan printer tidak terdeteksi",
        "Panduan troubleshooting koneksi printer",
      ]}
    />
  );
}
