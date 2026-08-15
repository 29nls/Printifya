# Matriks Fitur Modul Foto

Ringkasan kemampuan semua modul foto Printifya: pas foto, visa, custom size, dan auto layout.
Kelima modul pas foto memakai komponen bersama `PasFotoWorkflow`, sehingga fiturnya identik;
Auto Layout adalah modul tersendiri dengan filosofi berbeda (menerima foto jadi, tanpa crop).

## Matriks

| Fitur | Pas Foto 2×3 | Pas Foto 3×4 | Pas Foto 4×6 | Visa Photo | Custom Size | Auto Layout |
|---|---|---|---|---|---|---|
| **Mesin** | `PasFotoWorkflow` | `PasFotoWorkflow` (+bridge) | `PasFotoWorkflow` | `PasFotoWorkflow` + presets | `PasFotoWorkflow` + size dinamis | modul sendiri |
| **Crop** (upload → Cropper.js, rasio terkunci) | ✅ | ✅ | ✅ | ✅ | ✅ (rasio bebas) | ❌ (menerima foto jadi) |
| **Deteksi wajah** di editor | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Sheet A4** (pratinjau template + atur kolom/baris/margin) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Ekspor PDF** (.pdf) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Cetak** (dialog browser) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Auto-fill multi-foto** (beberapa orang → satu lembar) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Opsi **ulang** bila foto < sel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Multi-halaman** (foto > sel) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Label nama** per foto di lembar | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Ukuran | tetap 2×3 cm | tetap 3×4 cm | tetap 4×6 cm | 8 preset negara | bebas cm + DPI | preset 2×3 / 3×4 / 4×6 |

## Contoh Nama File PDF

Dihasilkan oleh `exportPasFotoPdf` (`{fileName}-a4.pdf`) untuk satu foto dan
`exportLayoutPdf` (`{fileName}-layout-a4.pdf`) untuk mode banyak orang / banyak foto.

| Modul | Satu foto | Banyak orang / foto |
|---|---|---|
| Pas Foto 2×3 | `pas-foto-2x3-a4.pdf` | `pas-foto-2x3-layout-a4.pdf` |
| Pas Foto 3×4 | `pas-foto-3x4-a4.pdf` | `pas-foto-3x4-layout-a4.pdf` |
| Pas Foto 4×6 | `pas-foto-4x6-a4.pdf` | `pas-foto-4x6-layout-a4.pdf` |
| Visa Photo — Schengen | `visa-schengen-a4.pdf` | `visa-schengen-layout-a4.pdf` |
| Visa Photo — Amerika Serikat | `visa-amerika-serikat-a4.pdf` | `visa-amerika-serikat-layout-a4.pdf` |
| Visa Photo — Inggris | `visa-inggris-a4.pdf` | `visa-inggris-layout-a4.pdf` |
| Visa Photo — Kanada | `visa-kanada-a4.pdf` | `visa-kanada-layout-a4.pdf` |
| Visa Photo — Australia | `visa-australia-a4.pdf` | `visa-australia-layout-a4.pdf` |
| Visa Photo — Jepang | `visa-jepang-a4.pdf` | `visa-jepang-layout-a4.pdf` |
| Visa Photo — Tiongkok | `visa-tiongkok-a4.pdf` | `visa-tiongkok-layout-a4.pdf` |
| Visa Photo — Indonesia (paspor) | `visa-indonesia-a4.pdf` | `visa-indonesia-layout-a4.pdf` |
| Custom Size | `custom-size-a4.pdf` | `custom-size-layout-a4.pdf` |
| Auto Layout — 2×3 | — | `auto-layout-2x3-layout-a4.pdf` |
| Auto Layout — 3×4 | — | `auto-layout-3x4-layout-a4.pdf` |
| Auto Layout — 4×6 | — | `auto-layout-4x6-layout-a4.pdf` |

## Catatan Implementasi

- **Infrastruktur bersama** (memungkinkan fitur identik lintas modul):
  - `PasFotoWorkflow` — alur upload → crop → hasil + template A4 + ekspor/cetak, termasuk
    mode "beberapa orang" (auto-fill, opsi ulang, multi-halaman, label nama).
  - `A4SheetPreview` — pratinjau template A4; mode `src` (satu foto diulang) atau `srcs`
    (banyak foto per sel, sel kosong bila habis) + label per sel.
  - `exportPdf.ts` — `buildSheetDoc` (grid fisik presisi mm, multi-halaman), `exportPasFotoPdf`,
    `exportLayoutPdf`, `printPasFotoPdf`, `printLayoutPdf` (autoPrint).
  - `printHtml.ts` — `buildHtmlSheet` + `printHtmlSheet` (cetak HTML via iframe, tanpa jsPDF).
  - `pasFotoBridge` — meneruskan hasil modul mana pun ke alur crop Pas Foto 3×4.
- **Cetak**: modul pas foto memakai jalur PDF + autoPrint (`printPasFotoPdf` / `printLayoutPdf`);
  Auto Layout memakai jalur HTML iframe (`printHtmlSheet`). Keduanya menampilkan dialog cetak
  browser / Simpan sebagai PDF.
- **Modul terkait (AI Assistant)**: Auto Crop Face, Background Removal, dan Enhance Photo adalah
  modul pengolahan foto yang bisa meneruskan hasilnya ke alur pas foto 3×4 via `pasFotoBridge`
  (tidak termasuk dalam matriks di atas karena bukan modul template cetak).
