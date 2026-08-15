import { ModulePage } from "../../../components/ModulePage";

export default function AutoCropFacePage() {
  return (
    <ModulePage
      icon="😀"
      title="Auto Crop Face"
      description="Deteksi wajah otomatis lalu crop foto agar posisi wajah pas dengan standar pas foto."
      features={[
        "Deteksi wajah otomatis (face detection)",
        "Auto crop ke rasio pas foto yang dipilih",
        "Penyesuaian posisi dan ukuran wajah",
        "Pratinjau hasil sebelum konfirmasi",
        "Koreksi manual bila deteksi kurang tepat",
      ]}
    />
  );
}
