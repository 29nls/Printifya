import { ModulePage } from "../../../components/ModulePage";

export default function BackgroundRemovalPage() {
  return (
    <ModulePage
      icon="✂️"
      title="Background Removal"
      description="Hapus latar belakang foto secara otomatis dan ganti dengan warna polos sesuai ketentuan."
      features={[
        "Hapus latar belakang otomatis (AI)",
        "Ganti latar: putih, biru, abu-abu, atau gambar",
        "Perbaikan tepi (hair/edge refinement)",
        "Pratinjau sebelum / sesudah",
        "Hasil siap untuk pas foto dan visa photo",
      ]}
    />
  );
}
