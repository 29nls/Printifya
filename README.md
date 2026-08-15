# Printifya

Aplikasi web cetak pas foto & dokumen: studio pas foto, editor dokumen,
pencetakan, dan bantuan AI — sesuai PRD di `docs/project prd.md`.

## Struktur Modul

```
Printifya
│
├── Photo Studio            → src/modules/photo-studio
│   ├── Pas Foto 2x3        → photo-studio/pas-foto-2x3
│   ├── Pas Foto 3x4        → photo-studio/pas-foto-3x4
│   ├── Pas Foto 4x6        → photo-studio/pas-foto-4x6
│   ├── Visa Photo          → photo-studio/visa-photo
│   └── Custom Size         → photo-studio/custom-size
│
├── Document Studio         → src/modules/document-studio
│   ├── Word Editor         → document-studio/word-editor
│   ├── Excel Sheet         → document-studio/excel-sheet
│   ├── PDF Editor          → document-studio/pdf-editor
│   └── Template Surat      → document-studio/template-surat
│
├── Print Center            → src/modules/print-center
│   ├── Printer Lokal       → print-center/printer-lokal
│   ├── QZ Tray             → print-center/qz-tray
│   ├── Network Printer     → print-center/network-printer
│   └── PDF Export          → print-center/pdf-export
│
└── AI Assistant            → src/modules/ai-assistant
    ├── Auto Crop Face      → ai-assistant/auto-crop-face
    ├── Background Removal  → ai-assistant/background-removal
    ├── Enhance Photo       → ai-assistant/enhance-photo
    └── Auto Layout         → ai-assistant/auto-layout
```

## Cara Kerja

- **`src/modules/registry.ts`** — satu sumber kebenaran untuk pohon modul:
  setiap folder modul diekspor lewat `index.tsx`, lalu didaftarkan di sini
  beserta path rute-nya.
- **Navigasi** — sidebar di `src/App.tsx` dirender otomatis dari `MODULES`,
  jadi menambah modul baru cukup: buat folder + `index.tsx`, lalu daftarkan
  di `registry.ts`.
- Setiap modul daun saat ini berupa placeholder (`ModulePage`) yang memuat
  daftar fitur yang direncanakan, siap diisi dengan implementasi nyata.

## Menjalankan

```bash
npm install
npm run dev        # development server (http://localhost:5173)
npm run build      # typecheck + production build
npm run typecheck  # typecheck saja
```
