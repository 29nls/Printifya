import { ModulePage } from "../../../components/ModulePage";

export default function NetworkPrinterPage() {
  return (
    <ModulePage
      icon="🌐"
      title="Network Printer"
      description="Cetak ke printer jaringan (IPP) dan kelola daftar printer yang tersedia."
      features={[
        "Dukungan protokol IPP / printer jaringan",
        "Pindai dan pilih printer yang tersedia",
        "Pengaturan kualitas dan ukuran kertas",
        "Fallback ke PDF bila printer jaringan gagal",
        "Status dan antrean job cetak",
      ]}
    />
  );
}
