import { lazy, type ComponentType } from "react";

// Semua halaman modul dimuat secara lazy (code-splitting) agar library berat
// seperti cropperjs & jspdf hanya diunduh saat modul terkait dibuka.

// Grup modul
const PhotoStudioPage = lazy(() => import("./photo-studio"));
const DocumentStudioPage = lazy(() => import("./document-studio"));
const PrintCenterPage = lazy(() => import("./print-center"));
const AiAssistantPage = lazy(() => import("./ai-assistant"));

// Photo Studio (pas-foto pages are factory-generated, one import for all 3)
import { PasFoto2x3Page, PasFoto3x4Page, PasFoto4x6Page } from "./photo-studio/shared/pasFotoPages";
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
const UpscaleDenoisePage = lazy(() => import("./ai-assistant/upscale-denoise"));
const FaceEnhancePage = lazy(() => import("./ai-assistant/face-enhance"));
const VideoFaceEnhancePage = lazy(() => import("./ai-assistant/video-face-enhance"));
const SlideshowToVideoPage = lazy(() => import("./ai-assistant/slideshow-to-video"));

// Tools (Fitur Cepat)
const ScanPage = lazy(() => import("./scan"));
const QuickTemplatesPage = lazy(() => import("./quick-templates"));
const QRGeneratorPage = lazy(() => import("./qr-generator"));
const PrintHistoryPage = lazy(() => import("./print-history"));

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
        description:
          "Editor teks kaya WYSIWYG — format langsung, kertas A3–R30, lalu cetak / simpan PDF via dialog browser.",
        Component: WordEditorPage,
      },
      {
        id: "excel-sheet",
        title: "Excel Sheet",
        path: "/document-studio/excel-sheet",
        icon: "📊",
        description:
          "Spreadsheet 2 lembar dengan formula (SUM, IF, ROUND, TODAY…), format angka, ekspor CSV, dan cetak.",
        Component: ExcelSheetPage,
      },
      {
        id: "pdf-editor",
        title: "PDF Editor",
        path: "/document-studio/pdf-editor",
        icon: "📄",
        description:
          "Lihat, gabung, pisah, putar, dan hapus halaman PDF — langsung di browser (pdf-lib).",
        Component: PdfEditorPage,
      },
      {
        id: "template-surat",
        title: "Template Surat",
        path: "/document-studio/template-surat",
        icon: "✉️",
        description:
          "Surat resmi ber-kop instansi: nomor/tanggal otomatis, arsip riwayat, kertas A3–R30, ekspor PDF & cetak.",
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
        description:
          "Cetak template HTML (grid pas foto presisi mm) langsung ke printer lokal via dialog browser — iframe print, tanpa jsPDF.",
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
        description:
          "Cetak ke printer jaringan: rute otomatis QZ Tray (raw ESC/POS) → IPP → fallback PDF, dengan antrean job.",
        Component: NetworkPrinterPage,
      },
      {
        id: "pdf-export",
        title: "PDF Export",
        path: "/print-center/pdf-export",
        icon: "📦",
        description:
          "Ekspor foto (template pas foto) & dokumen ke PDF siap cetak — kertas A3–R30, margin, orientasi.",
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
        description:
          "Hapus latar belakang otomatis (skin-tone + flood fill) dengan opsi segmen ala rembg (post-process mask, alpha matting, erode) dan ganti warna polos/transparan — komposit & encode hasil berjalan di Web Worker (UI tidak membeku; fallback thread utama), panel banding checkerboard sebelum/sesudah, unduh mask, terusan ke pas foto & Auto Layout, preferensi tersimpan dengan tombol reset.",
        Component: BackgroundRemovalPage,
      },
      {
        id: "enhance-photo",
        title: "Enhance Photo",
        path: "/ai-assistant/enhance-photo",
        icon: "✨",
        description:
          "Perbaiki pencahayaan, kontras, dan ketajaman otomatis berbasis histogram — slider manual, perbandingan sebelum/sesudah, pipeline resolusi penuh di Web Worker (UI tetap responsif; fallback thread utama), terusan ke pas foto & Auto Layout, preferensi tersimpan dengan tombol reset.",
        Component: EnhancePhotoPage,
      },
      {
        id: "auto-layout",
        title: "Auto Layout",
        path: "/ai-assistant/auto-layout",
        icon: "🧩",
        description:
          "Susun banyak foto otomatis ke template halaman cetak — drag untuk mengatur urutan (lembar & strip), 60 bingkai photobox dengan teks Booth per foto, garis potong, ekspor PDF & cetak HTML; framing batch dijalankan di Web Worker (UI tidak membeku; fallback thread utama).",
        Component: AutoLayoutPage,
      },
      {
        id: "upscale-denoise",
        title: "Upscale & Denoise",
        path: "/ai-assistant/upscale-denoise",
        icon: "⬆️",
        description:
          "Perbesar resolusi & kurangi noise (gaya Waifu2x): preset model (Photo-HQ-W4xEX, Photo-Conservative-x4, Photo-Small-W2xEX, Universal-Fast-W2xEX), skala 2×–8×/kustom, denoise 0–3, TTA, batch, perbandingan format & PSNR — pengaturan tersimpan, terusan ke pas foto & Auto Layout, tombol reset preferensi.",
        Component: UpscaleDenoisePage,
      },
      {
        id: "face-enhance",
        title: "Face Enhance",
        path: "/ai-assistant/face-enhance",
        icon: "👤",
        description:
          "Pulihkan kualitas wajah (gaya CodeFormer): pemulusan kulit, koreksi warna & ketajaman pada area wajah dengan slider fidelitas w, perbaikan latar opsional, pulihkan warna foto lama, perbesaran 2×/4× SETELAH pemulihan (urutan CodeFormer → Real-ESRGAN) — perbandingan sebelum/sesudah, perbandingan kualitas vs Video Face Enhance pada frame yang sama (PSNR/diff), terusan ke pas foto & Auto Layout, preferensi tersimpan dengan tombol reset. Pipeline full-res (restore + perbesaran) berjalan di Web Worker (OffscreenCanvas, fallback thread utama) sehingga foto besar tidak membekukan UI — hasil piksel identik dengan jalur lama.",
        Component: FaceEnhancePage,
      },
      {
        id: "video-face-enhance",
        title: "Video Face Enhance",
        path: "/ai-assistant/video-face-enhance",
        icon: "🎥",
        description:
          "Pulihkan kualitas wajah pada video (gaya PGTFormer, IJCAI'24): pemulihan wajah per frame (parsing-guided) dengan koherensi temporal tanpa pre-alignment, pipeline per-frame berjalan di Web Worker (UI tetap responsif untuk video panjang; fallback thread utama), sampling frame (semua/setengah/sepertiga — 2×/3× lebih cepat, durasi tetap), ekspor WebM/MP4 dengan track audio sumber dipertahankan (WebAudio → MediaStreamDestination) + indikator mini waveform audio terbaca, bandingkan audio sebelum/sesudah via dua pemutar yang sinkron (Putar Keduanya) dengan tombol mute eksplisit, terusan frame ke pas foto & Auto Layout — preferensi tersimpan dengan tombol reset.",
        Component: VideoFaceEnhancePage,
      },
      {
        id: "slideshow-to-video",
        title: "Slideshow to Video",
        path: "/ai-assistant/slideshow-to-video",
        icon: "🎞️",
        description:
          "Susun beberapa foto menjadi video WebM dengan transisi fade — musik latar opsional (loop) via recordWithAudio, pratinjau real-time, pengaturan tersimpan dengan tombol reset.",
        Component: SlideshowToVideoPage,
      },
    ],
  },
  {
    id: "tools",
    title: "Fitur Cepat",
    path: "/tools",
    icon: "⚡",
    description:
      "Alat cetak cepat: scan dokumen, template siap pakai, QR code, dan riwayat cetak.",
    Component: null as unknown as ComponentType,
    children: [
      {
        id: "scan",
        title: "Scan & Digitize",
        path: "/tools/scan",
        icon: "📷",
        description:
          "Foto dokumen → detect tepi otomatis → luruskan (perspective transform) → bersihkan → simpan PDF/PNG.",
        Component: ScanPage,
      },

      {
        id: "quick-templates",
        title: "Template Cepat",
        path: "/tools/templates",
        icon: "📑",
        description:
          "Template siap pakai: kwitansi, surat pernyataan, surat domisili, label, formulir biodata, bon.",
        Component: QuickTemplatesPage,
      },
      {
        id: "qr-generator",
        title: "QR Code",
        path: "/tools/qr",
        icon: "📱",
        description:
          "Buat QR code untuk WiFi, link, atau teks — unduh PNG atau cetak langsung.",
        Component: QRGeneratorPage,
      },
      {
        id: "print-history",
        title: "Riwayat Cetak",
        path: "/tools/history",
        icon: "📊",
        description:
          "Lihat riwayat dokumen yang sudah dicetak, statistik pemakaian, dan cetak ulang.",
        Component: PrintHistoryPage,
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
