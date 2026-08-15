# Matriks Fitur Printifya

Dokumen ini merangkum kemampuan modul-modul Printifya. Bagian pertama memuat semua modul foto
(pas foto, visa, custom size, auto layout); bagian kedua memuat modul Document Studio & Print
Center (PDF Editor, QZ Tray, Network Printer, PDF Export); bagian ketiga memuat semua modul AI
Assistant (Auto Crop Face, Background Removal, Enhance Photo, Auto Layout, Upscale & Denoise).

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
  (tidak termasuk dalam matriks di atas karena bukan modul template cetak). Auto Layout menerima
  hasil dari semua modul AI + pas foto via `autoLayoutBridge`. Modul terbaru **Upscale & Denoise**
  (gaya Waifu2x, heuristik) menambah kemampuan perbesaran resolusi & pengurangan noise serta
  meneruskan hasilnya ke pas foto & Auto Layout (awalan `waifu2x-`).

---

# Matriks Fitur Modul Document Studio & Print Center

Keempat modul berikut adalah modul yang baru diimplementasikan (sebelumnya placeholder):
**PDF Editor** (Document Studio), **QZ Tray**, **Network Printer**, dan **PDF Export** (Print Center).

## Matriks

| Fitur | PDF Editor | QZ Tray | Network Printer | PDF Export |
|---|---|---|---|---|
| **Mesin** | pdf-lib (lazy import) | WebSocket → QZ Tray | `qzClient` (QZ Tray) + IPP heuristik (`no-cors`) | `exportPdf` + `printHtml` + jsPDF |
| Upload / pratinjau | ✅ PDF upload + iframe native | — | — | ✅ foto upload |
| Jumlah halaman & ukuran file | ✅ | — | — | — |
| **Gabung** PDF | ✅ (semua dokumen) | — | — | — |
| **Pisah** rentang halaman (`1-3`) | ✅ | — | — | — |
| **Putar 90°** | ✅ | — | — | — |
| **Hapus halaman** | ✅ | — | — | — |
| Unduh / buka hasil | ✅ (setiap operasi → dokumen baru) | — | — | ✅ |
| Koneksi QZ Tray (`ws://localhost:8181`) | — | ✅ status + handshake | — | — |
| Daftar printer | — | ✅ `findPrinters`/`findPrinter` | ✅ registri + persist localStorage | — |
| Cetak raw ESC/POS | — | ✅ tes cetak (init/tebal/teks/cut) | ✅ (via `qzClient`) | — |
| Rute otomatis **QZ Tray → IPP → fallback PDF** | — | — | ✅ (QZ dulu, turun ke IPP, lalu PDF) | — |
| Antrean job + status | — | — | ✅ (antre/mengirim/berhasil/gagal) | — |
| Uji koneksi printer IPP | — | — | ✅ heuristik terjangkau/tidak | — |
| Fallback PDF (selalu berfungsi) | — | — | ✅ | — |
| Foto → PDF template pas foto | — | — | — | ✅ (2×3/3×4/4×6, grid) |
| Dokumen → PDF (teks selectable) | — | — | — | ✅ |
| Kertas A3/A4/A5/R2–R30 | — | — | — | ✅ |
| Orientasi potret/lanskap | — | — | — | ✅ |
| Margin (cm) | — | — | — | ✅ |
| Cetak (dialog browser) | — | — | — | ✅ (PDF autoPrint / HTML iframe) |
| Panduan & status | — | ✅ panduan instalasi + log | ✅ catatan keterbatasan IPP | — |

## Contoh Nama File

| Modul | Pola | Contoh |
|---|---|---|
| PDF Editor — gabung | `<daftar>-merged.pdf` | `dok-a-dok-b-merged.pdf` |
| PDF Editor — pisah | `<nama>-pages-<rentang>.pdf` | `dok-x-pages-2-3.pdf` |
| PDF Editor — putar | `<nama>-rotated.pdf` | `dok-x-rotated.pdf` |
| PDF Editor — hapus | `<nama>-deleted.pdf` | `dok-x-deleted.pdf` |
| Network Printer — fallback | `job-<id>.pdf` | `job-a1b2.pdf` |
| PDF Export — foto | `<nama-pas-foto>-<kertas>.pdf` | `pas-foto-3x4-a4.pdf` |
| PDF Export — dokumen | `dokumen-<kertas>-<orientasi>.pdf` | `dokumen-a4-landscape.pdf` |

## Catatan Implementasi

- **PDF Editor** memakai **pdf-lib** (dependency baru, dimuat lazy bersama chunk modul agar bundle
  awal tetap ringan). Setiap operasi (gabung/pisah/putar/hapus) menghasilkan dokumen baru
  "✨ hasil" — dokumen asli tidak pernah diubah. Pratinjau memakai penampil PDF bawaan browser
  (iframe blob URL). PDF terenkripsi dibuka dengan `ignoreEncryption` (bila didukung).
- **QZ Tray** adalah klien WebSocket ke `ws://localhost:8181` dengan protokol QZ: handshake
  `{{"qz-tray","v1.0","1.0.0","beta"}}`, lalu `findPrinters`/`findPrinter` dan `print`
  (data raw base64 ESC/POS). Semua kegagalan ditangani dengan pesan jelas; tanpa QZ Tray
  terpasang modul aman terputus. Tidak ada dependency baru.
- **Network Printer** tidak bisa mengirim IPP sungguhan dari browser (CORS lintas-asal), jadi
  modul menyediakan registri printer (persist localStorage), uji koneksi heuristik `no-cors`,
  antrean job dengan status, dan **fallback ekspor PDF** yang selalu berfungsi. Cetak memakai
  **rute otomatis**: (1) bila QZ Tray terhubung, job dicetak raw ESC/POS ke printer QZ terpilih;
  (2) bila gagal/tidak terhubung, dicoba lewat IPP heuristik; (3) bila IPP tak terjangkau, job
  berstatus gagal dengan catatan jelas + tombol "Ekspor PDF (fallback)". Klien QZ dipakai
  bersama dengan modul QZ Tray lewat `print-center/qz-tray/qzClient.ts` (satu sumber kebenaran
  protokol WebSocket QZ: handshake → `findPrinters`/`findPrinter` → `print` raw base64). Dua bug
  kecil ditemukan & diperbaiki saat verifikasi: heuristik `no-cors` yang menelan kegagalan
  jaringan, dan `"tidak terjangkau".includes("terjangkau")` yang membuat job "berhasil" padahal
  printer tidak terjangkau.
- **PDF Export** adalah hub ekspor yang memakai ulang infrastruktur inti: mode foto
  (`exportPasFotoPdf` + grid kolom/baris + kertas/orientasi), mode dokumen (jsPDF teks native
  selectable), dan tombol Cetak (foto → PDF autoPrint; dokumen → iframe HTML `printHtmlSheet`).

---

# Matriks Fitur Modul AI Assistant

Lima modul pengolahan foto AI Assistant. Semua berbasis heuristik (tanpa dependency ML),
sesuai konvensi proyek: deteksi wajah berbasis skin-tone, hapus latar berbasis flood fill,
koreksi berbasis histogram, dan upscale/denoise gaya Waifu2x.

## Matriks

| Fitur | Auto Crop Face | Background Removal | Enhance Photo | Auto Layout | Upscale & Denoise |
|---|---|---|---|---|---|
| **Mesin** | `autocrop.ts` + `detectFace` | `bgRemove.ts` (skin-tone + flood fill) | histogram + slider | modul sendiri (grid A4) | `waifu2x.ts` (heuristik) |
| Upload | ✅ | ✅ | ✅ | ✅ (banyak foto) | ✅ (batch) |
| **Deteksi wajah otomatis** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Crop rasio pas foto** | ✅ (otomatis + edit manual fallback) | ❌ | ❌ | ❌ | ❌ |
| Slider proporsi wajah (zoom, `--facePercent`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Kasus tanpa wajah → pesan + edit manual | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Hapus latar** (transparan/putih/biru/merah) | ❌ | ✅ | ❌ | ❌ | ❌ |
| Post-proses mask (opening morfologi) | ❌ | ✅ (`--post-process-mask`) | ❌ | ❌ | ❌ |
| Alpha matting (erode size) | ❌ | ✅ (`-a`) | ❌ | ❌ | ❌ |
| Unduh mask grayscale | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Auto-koreksi** pencahayaan/kontras/ketajaman | ❌ | ❌ | ✅ | ❌ | ❌ |
| Slider manual + perbandingan sebelum/sesudah | ❌ | ❌ | ✅ | ❌ | ❌ |
| **Perbesaran resolusi** (2×/4×/8×/kustom) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Denoise level 0–3 (median filter) | ❌ | ❌ | ❌ | ❌ | ✅ |
| TTA (rata-rata 4 orientasi) | ❌ | ❌ | ❌ | ❌ | ✅ |
| Format output PNG/WebP/JPG + kualitas | ❌ | ❌ | ❌ | ❌ | ✅ |
| Perbandingan hasil (slider) | ❌ | ❌ | ✅ | ❌ | ✅ |
| Perbandingan format PNG/WebP/JPG (ukuran file + PSNR) | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Unduh Semua** (batch berurutan, aman browser) | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Susun lembar cetak** (grid kolom/baris) | ❌ | ❌ | ❌ | ✅ | ❌ |
| Kertas A3/A4/A5/R2–R30 | ❌ | ❌ | ❌ | ✅ | ❌ |
| Orientasi otomatis potret/lanskap | ❌ | ❌ | ❌ | ✅ | ❌ |
| Label nama per foto di lembar | ❌ | ❌ | ❌ | ✅ | ❌ |
| Pratinjau ukuran penuh 1:1 (scroll) | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Drag urut ulang foto** (lembar antar sel + strip thumbnail) | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Bingkai photobox** (50 bingkai, 5 kategori, pratinjau live) | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Garis potong (sekat)** antar foto — default aktif (pratinjau/PDF/cetak) | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Ekspor PDF** (.pdf) | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Cetak** (dialog browser, iframe HTML) | ❌ | ❌ | ❌ | ✅ | ❌ |
| Unduh hasil | ✅ PNG | ✅ PNG + mask | ✅ PNG | — (PDF/cetak) | ✅ PNG/WebP/JPG per foto |
| Terusan **Jadikan Pas Foto 3×4** (`pasFotoBridge`) | ✅ | ✅ | ✅ | ✅ (per foto) | ✅ (per hasil) |
| Terusan **Susun ke Auto Layout** (`autoLayoutBridge`) | ✅ (prefix `auto-`) | ✅ (`bg-`) | ✅ (`enhanced-`) | — (modul itu sendiri) | ✅ (`waifu2x-`, satu atau batch) |
| Persist localStorage + tombol reset preferensi | ✅ | ✅ | ✅ | ✅ | ✅ |

## Contoh Nama File

| Modul | Pola | Contoh |
|---|---|---|
| Auto Crop Face | `<nama>-<rasio>.png` | `budi-3x4.png` |
| Background Removal | `<nama>-nobg.png` / `-mask.png` | `siti-nobg.png`, `siti-mask.png` |
| Enhance Photo | `<nama>-enhanced.png` | `foto-gelap-enhanced.png` |
| Upscale & Denoise | `<nama>-<skala>x-waifu2x.<fmt>` | `foto-dua-2.5x-waifu2x.jpg` |
| Auto Layout | `exportLayoutPdf` → `<ukuran>-layout-<kertas>.pdf` | `auto-layout-3x4-layout-a4.pdf` |

## Catatan Implementasi

- **Referensi eksternal** yang dipetakan: Auto Crop Face mengikuti algoritma
  [leblancfg/autocrop](https://github.com/leblancfg/autocrop) (safe zoom + crop positions + resize,
  padanan `--facePercent`); Background Removal mengikuti flag
  [danielgatis/rembg](https://github.com/danielgatis/rembg) (`--post-process-mask`, `-a/--alpha-matting`,
  `-om/--only-mask`, `--bgcolor`); Upscale & Denoise mengikuti alur
  [Waifu2x-Extension-GUI](https://github.com/AaronFeng753/Waifu2x-Extension-GUI) (skala, denoise,
  TTA, batch, bandingkan). Semua padanan heuristik tanpa jaringan saraf.
- **Bridge antar-modul**: `pasFotoBridge` meneruskan hasil ke alur crop Pas Foto 3×4 (semua
  modul AI + Auto Layout per foto + Upscale & Denoise per hasil); `autoLayoutBridge`
  meneruskan foto ke Auto Layout dengan awalan nama per modul (`auto-`, `bg-`, `enhanced-`,
  `waifu2x-`; Upscale & Denoise bisa mengirim semua hasil batch sekaligus via
  `setPendingLayoutPhotos`). Auto Layout juga menerima batch multi-orang dari Photo Studio.
- **Persistensi**: kelima modul menyimpan preferensi di localStorage dengan tombol
  `ResetPreferencesButton` (konfirmasi dua-klik): Auto Crop Face (zoom `--facePercent`),
  Background Removal (opsi segmen + awalan), Enhance Photo (awalan), Auto Layout
  (grid/kertas/label/bingkai/garis potong), Upscale & Denoise (skala/denoise/TTA/format/
  kualitas + awalan).
- **Edit Auto Layout**: foto bisa di-drag untuk mengatur ulang urutan — antar sel di lembar
  maupun thumbnail di strip (keduanya memakai array foto yang sama, jadi pratinjau, label,
  PDF, dan cetak ikut urutan baru). Bingkai photobox berasal dari
  `photo-studio/shared/frames.ts` (50 bingkai prosedural, 5 kategori:
  Klasik/Polaroid/Vintage/Festif/Modern — digambar di canvas, tanpa aset eksternal) dan
  diterapkan ke tiap foto di pratinjau, PDF, dan cetak. Garis potong putus-putus antar foto
  (default aktif) memudahkan pemotongan setelah cetak — diteruskan ke pratinjau
  (`A4SheetPreview`), ekspor PDF (`buildSheetDoc`), dan cetak HTML (`buildHtmlSheet`).
