import { ModulePage } from "../../../components/ModulePage";

export default function EnhancePhotoPage() {
  return (
    <ModulePage
      icon="✨"
      title="Enhance Photo"
      description="Perbaiki kualitas foto secara otomatis: kecerahan, kontras, ketajaman, dan pencahayaan."
      features={[
        "Auto enhance: pencahayaan & kontras",
        "Sharpen / pertegas detail wajah",
        "Reduksi noise pada foto gelap",
        "Penyesuaian warna kulit natural",
        "Bandingkan hasil sebelum / sesudah",
      ]}
    />
  );
}
