import { lazy, type ComponentType } from "react";

// Semua halaman modul dimuat secara lazy (code-splitting) agar library berat
// seperti cropperjs & jspdf hanya diunduh saat modul terkait dibuka.

// Grup modul
const PhotoStudioPage = lazy(() => import("./photo-studio"));
const DocumentStudioPage = lazy(() => import("./document-studio"));
const PrintCenterPage = lazy(() => import("./print-center"));
const AiAssistantPage = lazy(() => import("./ai-assistant"));

// Photo Studio
const PasFoto2x3Page = lazy(() => import("./photo-studio/pas-foto-2x3"));
const PasFoto3x4Page = lazy(() => import("./photo-studio/pas-foto-3x4"));
const PasFoto4x6Page = lazy(() => import("./photo-studio/pas-foto-4x6"));
const VisaPhotoPage = lazy(() => import("./photo-studio/visa-photo"));
const CustomSizePage = lazy(() => import("./photo-studio/custom-size"));

// Document Studio
const WordEditorPage = lazy(() => import("./document-studio/word-editor"));
const ExcelSheetPage = lazy(() => import("./document-studio/excel-sheet"));
const PdfEditorPage = lazy(() => import("./document-studio/pdf-editor"));
const TemplateSuratPage = lazy(() => import("./document-studio/template-surat"));

// Print Center
const PrinterLokalPage = lazy(() => import("./print-center/printer-lokal"));
const QzTrayPage = lazy(() => import("./print-center/qz-tray"));
const NetworkPrinterPage = lazy(() => import("./print-center/network-printer"));
const PdfExportPage = lazy(() => import("./print-center/pdf-export"));

// AI Assistant
const AutoCropFacePage = lazy(() => import("./ai-assistant/auto-crop-face"));
const BackgroundRemovalPage = lazy(() => import("./ai-assistant/background-removal"));
const EnhancePhotoPage = lazy(() => import("./ai-assistant/enhance-photo"));
const AutoLayoutPage = lazy(() => import("./ai-assistant/auto-layout"));

export interface Module {
  id: string;
  title: string;
  path: string;
  description: string;
  icon: string;
  Component: ComponentType;
  children?: Module[];
}

export const MODULES: Module[] = [
  {
    id: "photo-studio",
    title: "Photo Studio",
    path: "/photo-studio",
    icon: "📷",
    description:
      "Buat pas foto standar 2×3, 3×4, 4×6, visa photo, atau ukuran kustom dengan crop otomatis dan template cetak.",
    Component: PhotoStudioPage,
    children: [
      {
        id: "pas-foto-2x3",
        title: "Pas Foto 2x3",
        path: "/photo-studio/pas-foto-2x3",
        icon: "🪪",
        description: "Pas foto standar 2×3 cm (236×354 px @ 300 DPI).",
        Component: PasFoto2x3Page,
      },
      {
        id: "pas-foto-3x4",
        title: "Pas Foto 3x4",
        path: "/photo-studio/pas-foto-3x4",
        icon: "🪪",
        description: "Pas foto standar 3×4 cm (354×472 px @ 300 DPI).",
        Component: PasFoto3x4Page,
      },
      {
        id: "pas-foto-4x6",
        title: "Pas Foto 4x6",
        path: "/photo-studio/pas-foto-4x6",
        icon: "🪪",
        description: "Pas foto standar 4×6 cm (472×709 px @ 300 DPI).",
        Component: PasFoto4x6Page,
      },
      {
        id: "visa-photo",
        title: "Visa Photo",
        path: "/photo-studio/visa-photo",
        icon: "🌍",
        description:
          "Pas foto sesuai ketentuan visa berbagai negara (Schengen 35×45 mm, AS 2×2 in).",
        Component: VisaPhotoPage,
      },
      {
        id: "custom-size",
        title: "Custom Size",
        path: "/photo-studio/custom-size",
        icon: "📐",
        description: "Ukuran cetak bebas: lebar, tinggi, DPI, dan orientasi.",
        Component: CustomSizePage,
      },
    ],
  },
  {
    id: "document-studio",
    title: "Document Studio",
    path: "/document-studio",
    icon: "📄",
    description:
      "Buat dan edit dokumen: teks kaya, spreadsheet, PDF, serta template surat resmi.",
    Component: DocumentStudioPage,
    children: [
      {
        id: "word-editor",
        title: "Word Editor",
        path: "/document-studio/word-editor",
        icon: "📝",
        description: "Editor teks kaya WYSIWYG dengan ekspor DOCX/PDF.",
        Component: WordEditorPage,
      },
      {
        id: "excel-sheet",
        title: "Excel Sheet",
        path: "/document-studio/excel-sheet",
        icon: "📊",
        description: "Spreadsheet sederhana dengan formula dan ekspor XLSX.",
        Component: ExcelSheetPage,
      },
      {
        id: "pdf-editor",
        title: "PDF Editor",
        path: "/document-studio/pdf-editor",
        icon: "📄",
        description: "Lihat, gabung, dan pisah dokumen PDF siap cetak.",
        Component: PdfEditorPage,
      },
      {
        id: "template-surat",
        title: "Template Surat",
        path: "/document-studio/template-surat",
        icon: "✉️",
        description: "Template surat resmi dengan kolom isian otomatis.",
        Component: TemplateSuratPage,
      },
    ],
  },
  {
    id: "print-center",
    title: "Print Center",
    path: "/print-center",
    icon: "🖨️",
    description:
      "Cetak ke printer lokal, QZ Tray, printer jaringan, atau ekspor PDF sebagai fallback.",
    Component: PrintCenterPage,
    children: [
      {
        id: "printer-lokal",
        title: "Printer Lokal",
        path: "/print-center/printer-lokal",
        icon: "🖨️",
        description: "Cetak langsung via dialog browser / WebUSB / Print.js.",
        Component: PrinterLokalPage,
      },
      {
        id: "qz-tray",
        title: "QZ Tray",
        path: "/print-center/qz-tray",
        icon: "🔌",
        description: "Integrasi QZ Tray untuk raw printing lintas platform.",
        Component: QzTrayPage,
      },
      {
        id: "network-printer",
        title: "Network Printer",
        path: "/print-center/network-printer",
        icon: "🌐",
        description: "Cetak ke printer jaringan melalui protokol IPP.",
        Component: NetworkPrinterPage,
      },
      {
        id: "pdf-export",
        title: "PDF Export",
        path: "/print-center/pdf-export",
        icon: "📦",
        description: "Ekspor foto dan dokumen ke PDF siap cetak.",
        Component: PdfExportPage,
      },
    ],
  },
  {
    id: "ai-assistant",
    title: "AI Assistant",
    path: "/ai-assistant",
    icon: "✨",
    description:
      "Bantuan AI: deteksi wajah, hapus latar, perbaiki kualitas, dan susun layout otomatis.",
    Component: AiAssistantPage,
    children: [
      {
        id: "auto-crop-face",
        title: "Auto Crop Face",
        path: "/ai-assistant/auto-crop-face",
        icon: "😀",
        description: "Deteksi wajah dan crop otomatis ke rasio pas foto.",
        Component: AutoCropFacePage,
      },
      {
        id: "background-removal",
        title: "Background Removal",
        path: "/ai-assistant/background-removal",
        icon: "✂️",
        description: "Hapus latar belakang dan ganti warna polos otomatis.",
        Component: BackgroundRemovalPage,
      },
      {
        id: "enhance-photo",
        title: "Enhance Photo",
        path: "/ai-assistant/enhance-photo",
        icon: "✨",
        description: "Perbaiki pencahayaan, kontras, dan ketajaman otomatis.",
        Component: EnhancePhotoPage,
      },
      {
        id: "auto-layout",
        title: "Auto Layout",
        path: "/ai-assistant/auto-layout",
        icon: "🧩",
        description: "Susun banyak foto otomatis ke template halaman cetak.",
        Component: AutoLayoutPage,
      },
    ],
  },
];

/** Semua modul daun (tanpa children), dipakai untuk mendaftarkan rute. */
export const LEAF_MODULES: Module[] = MODULES.flatMap(
  (m) => m.children ?? []
);

/** Cari modul berdasarkan path rute. */
export function findModule(path: string): Module | undefined {
  for (const m of MODULES) {
    if (m.path === path) return m;
    const child = m.children?.find((c) => c.path === path);
    if (child) return child;
  }
  return undefined;
}
