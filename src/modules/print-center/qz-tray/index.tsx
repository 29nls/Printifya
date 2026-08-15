import { ModulePage } from "../../../components/ModulePage";

export default function QzTrayPage() {
  return (
    <ModulePage
      icon="🔌"
      title="QZ Tray"
      description="Integrasi aplikasi pendamping QZ Tray untuk cetak raw ke printer USB/COM/jaringan lintas platform."
      features={[
        "Koneksi ke QZ Tray via WebSocket",
        "Cetak raw / ESC/POS ke printer",
        "Deteksi daftar printer terpasang",
        "Status koneksi dan penanganan error",
        "Panduan instalasi QZ Tray dan pemberian izin",
      ]}
    />
  );
}
