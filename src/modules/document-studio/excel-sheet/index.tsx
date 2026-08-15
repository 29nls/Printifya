import { ModulePage } from "../../../components/ModulePage";

export default function ExcelSheetPage() {
  return (
    <ModulePage
      icon="📊"
      title="Excel Sheet"
      description="Spreadsheet sederhana mirip Excel: sel, formula dasar, dan impor/ekspor XLSX/CSV."
      features={[
        "Grid spreadsheet interaktif (Jspreadsheet / AG Grid)",
        "Formula dasar (SUM, AVERAGE, dll.)",
        "Impor & ekspor XLSX dan CSV",
        "Format sel: angka, tanggal, warna",
        "Cetak sheet dan ekspor PDF",
      ]}
    />
  );
}
