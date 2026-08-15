import { ModulePage } from "../../../components/ModulePage";

export default function AutoLayoutPage() {
  return (
    <ModulePage
      icon="🧩"
      title="Auto Layout"
      description="Susun banyak foto secara otomatis ke dalam template halaman cetak (mis. 2×3 dalam A4)."
      features={[
        "Auto layout banyak foto per halaman",
        "Preset template: 2×3, 3×4, 4×6 dalam A4",
        "Perhitungan margin dan spasi otomatis",
        "Atur jumlah foto per halaman",
        "Pratinjau halaman final sebelum cetak",
      ]}
    />
  );
}
