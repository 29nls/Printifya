import { ModulePage } from "../../../components/ModulePage";

export default function CustomSizePage() {
  return (
    <ModulePage
      icon="📐"
      title="Custom Size"
      description="Tentukan ukuran cetak foto bebas: lebar, tinggi, DPI, dan orientasi."
      features={[
        "Input ukuran bebas (cm / inci / piksel)",
        "Pengaturan DPI cetak (72–600)",
        "Orientasi potret / lanskap",
        "Template cetak kustom per halaman",
        "Pratinjau cetak real-time",
      ]}
    />
  );
}
