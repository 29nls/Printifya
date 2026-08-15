import { ModulePage } from "../../../components/ModulePage";

export default function VisaPhotoPage() {
  return (
    <ModulePage
      icon="🌍"
      title="Visa Photo"
      description="Pas foto sesuai ketentuan visa berbagai negara (Schengen 35×45 mm, AS 2×2 in, dll.)."
      features={[
        "Preset ukuran & latar sesuai aturan negara tujuan",
        "Auto crop dengan rasio visa yang dipilih",
        "Aturan jarak wajah dan kepala (head size) per negara",
        "Ganti latar belakang (putih / biru / abu-abu)",
        "Pratinjau dan cetak ke template halaman",
      ]}
    />
  );
}
