import { ModulePage } from "../../../components/ModulePage";

export default function WordEditorPage() {
  return (
    <ModulePage
      icon="📝"
      title="Word Editor"
      description="Editor dokumen teks kaya (WYSIWYG): format teks, tabel, gambar, hingga ekspor DOCX/PDF."
      features={[
        "Editor WYSIWYG (TipTap / Quill / Lexical)",
        "Format teks: bold, italic, heading, list, tabel",
        "Sisipkan gambar dan tautan",
        "Impor & ekspor DOCX, ekspor PDF",
        "Simpan otomatis dan cetak langsung",
      ]}
    />
  );
}
