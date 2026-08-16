# Matriks Fitur Printifya

Dokumen ini merangkum kemampuan modul-modul Printifya. Bagian pertama memuat semua modul foto
(pas foto, visa, custom size, auto layout); bagian kedua memuat modul Document Studio & Print
Center (PDF Editor, QZ Tray, Network Printer, PDF Export); bagian ketiga memuat semua modul AI
Assistant (Auto Crop Face, Background Removal, Enhance Photo, Auto Layout, Upscale & Denoise, Face Enhance, Video Face Enhance, Slideshow to Video).

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
  - `sheetLayout.ts` — matematika tata letak lembar dalam mm, sumber tunggal untuk
    pratinjau (`A4SheetPreview`), ekspor PDF (`exportPdf`), dan cetak HTML (`printHtml`):
    `orientedDims`/`chooseOrientation` (orientasi otomatis potret/lanskap), `fitsA4`,
    `maxCols`/`maxRows`, `computeSheetLayout` (grid + margin sentris), `sheetPageCount`,
    posisi sel absolut `sheetCellRect` (mm atau px via `scaleSheetLayout`) + `sheetCellAtPoint`
    (titik → indeks sel untuk logika drag), dan area label `sheetLabelBarMm`. Murni komputasi,
    tanpa jsPDF — ketiga jalur memakai hitungan grid & margin yang identik.
  - `exportPdf.ts` — `buildSheetDoc` (grid fisik presisi mm, multi-halaman), `exportPasFotoPdf`,
    `exportLayoutPdf`, `printPasFotoPdf`, `printLayoutPdf` (autoPrint); memakai `sheetLayout`
    untuk posisi sel, garis potong, dan area label.
  - `printHtml.ts` — `buildHtmlSheet` + `printHtmlSheet` (cetak HTML via iframe, tanpa jsPDF);
    tata letaknya juga dihitung oleh `sheetLayout`.
  - `pasFotoBridge` — meneruskan hasil modul mana pun ke alur crop Pas Foto 3×4.
  - `prefsStorage.ts` (`src/modules/shared/`) — satu helper akses localStorage bersama
    (`loadJSON` + validator, `saveJSON`, `loadString`/`saveString` untuk kunci string mentah,
    `removeKeys`) dipakai semua modul; tidak ada `localStorage.*` langsung di luar helper ini.
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

Tujuh modul pengolahan foto AI Assistant. Semua berbasis heuristik (tanpa dependency ML),
sesuai konvensi proyek: deteksi wajah berbasis skin-tone, hapus latar berbasis flood fill,
koreksi berbasis histogram, upscale/denoise gaya Waifu2x, pemulihan wajah gaya CodeFormer,
dan restorasi wajah video gaya PGTFormer.

## Matriks

| Fitur | Auto Crop Face | Background Removal | Enhance Photo | Auto Layout | Upscale & Denoise | Face Enhance | Video Face Enhance | Slideshow to Video |
|---|---|---|---|---|---|---|---|---|
| **Mesin** | `autocrop.ts` + `detectFace` | `bgRemove.ts` (skin-tone + flood fill) | histogram + slider | modul sendiri (grid A4) | `waifu2x.ts` (heuristik) | `faceEnhance.ts` (pemulihan wajah heuristik) | `videoEnhance.ts` (per-frame `faceEnhance` + koherensi temporal + MediaRecorder) | `slideshow.ts` (coverFit/frameAt) + `recordWithAudio` |
| **Pipeline Web Worker** (fallback thread utama bila tidak didukung) | ❌ | ❌ | ❌ | ❌ | ✅ (OffscreenCanvas) | ✅ (full-res, OffscreenCanvas) | ✅ (per-frame, tanpa OffscreenCanvas) | ❌ |
| Upload | ✅ | ✅ | ✅ | ✅ (banyak foto) | ✅ (batch) | ✅ | ✅ (video) | ✅ (banyak foto) |
| **Deteksi wajah otomatis** | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (per frame) | ❌ |
| **Crop rasio pas foto** | ✅ (otomatis + edit manual fallback) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Slider proporsi wajah (zoom, `--facePercent`) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Kasus tanpa wajah → pesan + fallback lembut | ✅ (edit manual) | ❌ | ❌ | ❌ | ❌ | ✅ (koreksi global) | ✅ (koreksi global per frame) | ❌ |
| **Hapus latar** (transparan/putih/biru/merah) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Post-proses mask (opening morfologi) | ❌ | ✅ (`--post-process-mask`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Alpha matting (erode size) | ❌ | ✅ (`-a`) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Unduh mask grayscale | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Pemulihan wajah** (pemulusan kulit + koreksi warna + ketajaman di kotak wajah) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (tiap frame) | ❌ |
| **Slider fidelitas `w`** (kekuatan pemulihan vs identitas — CodeFormer) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Pemulihan warna** foto pudar/hitam-putih + perbaikan latar (background enhancement) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **Restorasi wajah video** (per frame, durasi hasil ≈ sumber, ekspor WebM/MP4, **track audio sumber dipertahankan** via WebAudio + **indikator mini waveform** audio terbaca) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Video WebM dari foto** (transisi fade antar slide, musik latar opsional **loop** via `recordWithAudio` — output tidak senyap) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Koherensi temporal** (PGTFormer: blend hasil dengan frame sebelumnya, tanpa pre-alignment) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| FPS output, resolusi kerja (512 PGTFormer / 720 / asli), **sampling frame** (semua/setengah/sepertiga) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (FPS 15/24/30 + 720p/1080p) |
| Slider manual + perbandingan sebelum/sesudah | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ (video asli vs hasil, **Putar Keduanya sinkron** + **tombol mute eksplisit**) | ❌ (pratinjau play/pause + timecode) |
| **Perbesaran resolusi** (2×/4×/8×/kustom) | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (2×/4× setelah pemulihan — urutan CodeFormer → Real-ESRGAN) | ❌ | ❌ |
| Denoise level 0–3 (median filter) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| TTA (rata-rata 4 orientasi) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Model preset Waifu2x** (Photo-HQ-W4xEX · Photo-Conservative-x4 · Photo-Small-W2xEX · Universal-Fast-W2xEX — profil heuristik skala/denoise/TTA) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Format output PNG/WebP/JPG + kualitas | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ (PNG) | ❌ (video) | ✅ (WebM) |
| Perbandingan format PNG/WebP/JPG (ukuran file + PSNR) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Perbandingan kualitas Face vs Video Face Enhance** pada frame yang sama (PSNR ∞-safe + Δ rata-rata/maks + % piksel berubah) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ (perbandingan tersedia di Face Enhance) | ❌ |
| **Unduh Semua** (batch berurutan, aman browser) | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **Susun lembar cetak** (grid kolom/baris) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Kertas A3/A4/A5/R2–R30 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Orientasi otomatis potret/lanskap | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Label nama per foto di lembar | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Pratinjau ukuran penuh 1:1 (scroll) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Drag urut ulang foto** (lembar antar sel + strip thumbnail) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Bingkai photobox** (60 bingkai, 6 kategori, pratinjau live) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Garis potong (sekat)** antar foto — default aktif (pratinjau/PDF/cetak) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Ekspor PDF** (.pdf) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Cetak** (dialog browser, iframe HTML) | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Unduh hasil | ✅ PNG | ✅ PNG + mask | ✅ PNG | — (PDF/cetak) | ✅ PNG/WebP/JPG per foto | ✅ PNG | ✅ WebM/MP4 | ✅ WebM |
| Terusan **Jadikan Pas Foto** (`pasFotoBridge`) | ✅ 3×4 | ✅ 3×4 | ✅ 3×4 | ✅ 3×4 (per foto) | ✅ 3×4 (per hasil) | ✅ **2×3/3×4/4×6** (pilihan ukuran) | ✅ 3×4 (frame terpilih) | ❌ |
| Terusan **Susun ke Auto Layout** (`autoLayoutBridge`) | ✅ (prefix `auto-`) | ✅ (`bg-`) | ✅ (`enhanced-`) | — (modul itu sendiri) | ✅ (`waifu2x-`, satu atau batch) | ✅ (`face-`) | ✅ (`video-`, frame terpilih) | ❌ |
| Persist localStorage + tombol reset preferensi | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Contoh Nama File

| Modul | Pola | Contoh |
|---|---|---|
| Auto Crop Face | `<nama>-<rasio>.png` | `budi-3x4.png` |
| Background Removal | `<nama>-nobg.png` / `-mask.png` | `siti-nobg.png`, `siti-mask.png` |
| Enhance Photo | `<nama>-enhanced.png` | `foto-gelap-enhanced.png` |
| Upscale & Denoise | `<nama>-<skala>x-waifu2x.<fmt>` | `foto-dua-2.5x-waifu2x.jpg` |
| Face Enhance | `<nama>-face-enhanced.png` | `budi-face-enhanced.png` |
| Video Face Enhance | `<nama>-face-restored.<fmt>` | `budi-wedding-face-restored.webm` |
| Slideshow to Video | `slideshow.webm` | `acara-ultah-slideshow.webm` |
| Auto Layout | `exportLayoutPdf` → `<ukuran>-layout-<kertas>.pdf` | `auto-layout-3x4-layout-a4.pdf` |

## Catatan Implementasi

- **Referensi eksternal** yang dipetakan: Auto Crop Face mengikuti algoritma
  [leblancfg/autocrop](https://github.com/leblancfg/autocrop) (safe zoom + crop positions + resize,
  padanan `--facePercent`); Background Removal mengikuti flag
  [danielgatis/rembg](https://github.com/danielgatis/rembg) (`--post-process-mask`, `-a/--alpha-matting`,
  `-om/--only-mask`, `--bgcolor`); Upscale & Denoise mengikuti alur
  [Waifu2x-Extension-GUI](https://github.com/AaronFeng753/Waifu2x-Extension-GUI) (skala, denoise,
  TTA, batch, bandingkan); Face Enhance mengikuti
  [sczhou/CodeFormer](https://github.com/sczhou/CodeFormer) (pemulihan wajah buta, bobot
  fidelitas `w`, background enhancement, pemulihan warna foto lama); Video Face Enhance
  mengikuti [kepengxu/PGTFormer](https://github.com/kepengxu/PGTFormer) (restorasi wajah
  video buta, parsing-guided, koherensi temporal tanpa pre-alignment). Semua padanan
  heuristik tanpa jaringan saraf.
- **Face Enhance — pemulihan wajah heuristik**: `faceEnhance.ts` mendeteksi wajah (reuse
  `detectFace`), menghitung kotak wajah piksel (padding 30%, `computeFaceBox`), menganalisis
  histogram kotak wajah (`computeStretch` — persentil 5%–95%), lalu `enhancePixels` menerapkan
  pemulusan kulit (blur + blend hanya pada piksel kulit, mask di-feather), koreksi
  warna/kontras, dan ketajaman unsharp (lebih kuat di non-kulit: mata/alis/rambut). Slider
  **fidelitas `w`** mengalikan kekuatan semua efek (100 = foto hampir tak berubah, 0 =
  pemulihan penuh). Opsional: perbaikan latar (koreksi lembut di luar kotak — CodeFormer
  background enhancement) dan pemulihan warna (saturasi + hangat; disarankan otomatis untuk
  foto hitam-putih via `autoFaceParams`). **Perbesaran 2×/4× diterapkan SETELAH pemulihan**
  (opsi "Perbesaran (Real-ESRGAN)", default 2× seperti CodeFormer) — urutan
  restore-then-upscale: pemulihan mengembalikan informasi wajah yang hilang, lalu
  `upscaleCanvas` (reuse dari `waifu2x.ts`, resize bertahap kualitas tinggi) memperbesar
  hasilnya; memperbesar dulu tidak mengembalikan detail yang hilang. Tanpa wajah
  terdeteksi → koreksi global lembut dengan catatan. Bagian murni
  (`computeFaceBox`/`computeStretch`/`enhancePixels`) terpisah dari pembungkus canvas agar
  bisa diuji tanpa DOM; pembungkus `enhanceFace` (termasuk urutan restore→upscale) diuji
  dengan harness canvas mock. **Pipeline full-res berjalan di Web Worker**
  (`faceEnhance.worker.ts` + `faceEnhanceWorkerApi.ts`, pola worker Upscale & Denoise):
  `applyFaceEnhance` (kotak wajah → bentangan histogram → `enhancePixels`) adalah SUMBER
  TUNGGAL logika restore yang dipakai jalur worker DAN jalur thread utama, jadi  hasil identik; kotak wajah dihitung di thread utama saat upload (`detectFace` — murah,
  downscale ≤240 px) dan dikirim sebagai data; piksel masuk via transfer (tanpa salin),
  `upscaleCanvas` memakai `setCanvasFactory(OffscreenCanvas)` di worker, dan hasil keluar
  sebagai **Blob PNG** (`OffscreenCanvas.convertToBlob`) sehingga encode gambar besar
  (hingga ~12000 px) juga tidak membekukan UI. Unduh PNG / Jadikan Pas Foto / Susun ke
  Lembar A4 pada foto ≥2000 px tidak lagi membekukan UI: busy state + tombol nonaktif
  selama proses, fallback sinkron `enhanceFace` bila browser tanpa Worker.
- **Perbandingan kualitas Face vs Video Face Enhance** (`qualityCompare.ts`): tombol
  "Bandingkan pada frame ini" menjalankan kedua pipeline pada foto yang sama di resolusi
  kerja video (`pickWorkingSize` dari `resMode` tersimpan modul video — 512/720/asli,
  dibatasi 1600 px untuk foto sangat besar) lalu `comparePixels` menghitung **PSNR**
  (∞ bila identik), Δ rata-rata, Δ maks, dan % piksel berubah (>8 level) antar hasil —
  ditampilkan sebagai kartu metrik ringkas + gambar berdampingan. Karena kedua modul
  memakai inti pipeline yang sama per frame (`enhancePixels`), hasil identik (∞ dB) saat
  parameter sama; perbedaan muncul dari parameter tersimpan tiap modul dan resolusi kerja
  video (koherensi temporal `temporalBlend` bersifat identitas pada satu frame — hanya
  aktif antar frame video). `runFramePipeline`/`comparePipelines` diuji dengan harness canvas
  mock; kedua pipeline mendeteksi wajah pada kanvas kerjanya sendiri (pola `processOne`,
  frame tergambar sebelum dipulihkan — setara dengan deteksi pada sumber asli karena
  `detectFace` menormalisasi ke ≤240 px), jadi PSNR mencerminkan perbedaan parameter murni.
- **Upscale & Denoise berjalan di Web Worker + OffscreenCanvas**: pipeline `processImage`
  (upscale → denoise → TTA average) maupun perbandingan format `compareFormats` (encode
  PNG/WebP/JPG + PSNR) dijalankan di `waifu2x.worker.ts` (antrean pekerjaan per-id:
  `process` dan `compare`, kontrak tipe di `waifu2xWorkerApi.ts`), sehingga batch maupun
  tabel "📊 Format" tidak pernah membekukan UI. Pipeline dibuat agnostik kanvas
  (`setCanvasFactory`: `OffscreenCanvas` di worker, `HTMLCanvasElement` di thread utama);
  gambar masuk sebagai `ImageBitmap` via transfer (tanpa salin) — hasil proses disimpan
  sebagai bitmap referensi lossless dan di-transfer kembali ke worker saat compare
  (zero-copy, thread utama tidak menggambar apa pun). Batch diproses paralel dengan pool
  konkurrensi 3 (pembatalan `cancelledRef` tetap berlaku, badge progress per-item tetap
  ter-update). **Fallback thread utama**: browser tanpa `OffscreenCanvas`/`Worker`
  menjalankan pipeline dan compare langsung di thread utama (perilaku lama, hasil sama).
  Worker dibuat lazy dan di-terminate saat unmount; bitmap hasil dibebaskan eksplisit
  (`close()`) saat item dihapus / modul ditutup.
- **Bridge antar-modul**: `pasFotoBridge` meneruskan hasil ke alur crop pas foto (semua
  modul AI + Auto Layout per foto + Upscale & Denoise per hasil; Face Enhance memilih
  ukuran 2×3/3×4/4×6 lalu modul tujuan — Pas Foto 2×3, 3×4, 4×6 — semuanya mengonsumsi
  `peekPendingPasFoto` sebagai `initialImage` di `PasFotoWorkflow`); `autoLayoutBridge`
  meneruskan foto ke Auto Layout dengan awalan nama per modul (`auto-`, `bg-`, `enhanced-`,
  `waifu2x-`, `face-`, `video-`; Upscale & Denoise bisa mengirim semua hasil batch sekaligus
  via `setPendingLayoutPhotos`; Video Face Enhance mengirim frame video hasil yang sedang
  dipilih pengguna). Auto Layout juga menerima batch multi-orang dari Photo Studio.
- **Slideshow to Video — video WebM dari foto dengan fade**: `slideshow.ts` memuat logika
  murni (tanpa DOM) yang dipakai pratinjau DAN rekaman agar frame identik: `coverFit`
  (rect cover-fit terpusat, tidak ada pita kosong), `frameAt` (state slide aktif + proporsi
  fade; fade dimulai `fadeDur` sebelum peralihan, dibatasi setengah durasi slide, slide
  terakhir tidak fade keluar), `totalDuration` (slide × durasi per slide). Rekaman berjalan
  real-time: canvas kerja (720p/1080p sesuai pilihan) digambar tiap rAF sambil di-capture
  via `canvas.captureStream(fps)` + `MediaRecorder` (WebM) memakai helper bersama
  `src/modules/shared/recordWithAudio.ts` dengan opsi `loop` untuk musik latar
  (`AudioBuffer` di-decode dalam gestur klik, diputar berulang via BufferSource →
  MediaStreamAudioDestinationNode — output tidak senyap; tanpa musik, hasil direkam
  senyap). Progress rekaman (persen + waktu nyata) tampil dengan tombol Hentikan yang
  membuang hasil parsial; pratinjau play/pause + timecode memakai logika frame yang sama.
- **Persistensi**: delapan modul menyimpan preferensi di localStorage dengan tombol
  `ResetPreferencesButton` (konfirmasi dua-klik): Auto Crop Face (zoom `--facePercent`),
  Background Removal (opsi segmen + awalan), Enhance Photo (awalan), Auto Layout
  (grid/kertas/label/bingkai/garis potong), Upscale & Denoise (skala/denoise/TTA/format/
  kualitas + awalan), Face Enhance (awalan), Video Face Enhance (semua opsi pipeline —
  fidelitas, pemulusan, ketajaman, warna, latar, pemulihan warna, koherensi temporal, FPS,
  resolusi kerja, format — + awalan), Slideshow to Video (durasi per slide, fade, FPS,
  resolusi). Semua akses localStorage lewat helper bersama
  `src/modules/shared/prefsStorage.ts` (`loadJSON` dengan validator per modul, `saveJSON`,
  `loadString`/`saveString`, `removeKeys`) — modul yang memvalidasi field saat muat (Auto
  Layout, Upscale & Denoise, Background Removal, Custom Size, Network Printer) meneruskan
  validatornya ke helper; kunci string mentah (awalan label, ukuran kertas Word
  Editor/Template Surat, zoom wajah) memakai `loadString`/`saveString` dengan semantik
  `getItem` yang sama. Helper ini juga dipakai Photo Studio, Template Surat, dan Network
  Printer, jadi kunci `printifya.*` dan format data lama tetap terbaca tanpa migrasi.
- **Video Face Enhance — restorasi wajah video heuristik**: `videoEnhance.ts` memakai
  pipeline per-frame `faceEnhance` (deteksi wajah per frame → kotak wajah → `enhancePixels`
  — padanan parsing-guided PGTFormer) lalu `temporalBlend` menyatukan hasil dengan frame
  sebelumnya (kuat di kotak wajah, lemah di latar) untuk koherensi temporal tanpa
  pre-alignment (kurangi kedipan). Ukuran kerja `pickWorkingSize` membatasi sisi terpanjang
  ke 512 (sesuai PGTFormer) / 720 / asli dengan dimensi genap; `countFrames` menentukan
  jumlah frame (durasi × FPS output). Orkestrasi di `index.tsx`: video di-seek per frame
  (`seekTo`), digambar ke canvas, diproses, lalu direkam via `canvas.captureStream` +
  `MediaRecorder` (WebM, atau MP4 bila didukung browser) dengan jeda yang di-pace ke waktu
  nyata agar durasi hasil ≈ durasi sumber; tombol Batal menghentikan perekaman dan membuang
  hasil parsial. Track audio sumber dipertahankan: audio di-decode sekali menjadi
  `AudioBuffer` (`decodeAudioData`, hasil di-cache) lalu diputar ulang via WebAudio
  (`BufferSource` → `MediaStreamAudioDestinationNode`) saat rekaman dimulai — elemen video
  tidak pernah diputar (hanya di-seek/di-draw), sehingga drawImage tidak men-taint canvas
  (perilaku Chromium bila elemen video diputar lewat WebAudio). Output tidak senyap bila
  video sumber punya suara; bila decode gagal, buffer melebihi batas memori (~100 MB), atau
  muxing audio+video tak didukung (mis. MP4 tertentu), fallback otomatis ke rekaman video saja. Frame video hasil bisa diteruskan ke Pas Foto 3×4 / Auto Layout (prefix
  `video-`). **Indikator mini waveform**: audio di-decode segera setelah upload via
  `OfflineAudioContext` (tanpa gestur/warning autoplay, hasil di-cache dan dipakai ulang
  oleh `run()`) lalu `computePeaks` (puncak gabungan kanal per bucket) digambar sebagai SVG
  kecil di samping badge 🔊 — bukti visual audio benar-benar terbaca; decode gagal
  menampilkan "⚠️ audio tak terbaca". Cache audio di-reset saat video berganti (buffer video
  lama tidak pernah diputar untuk video baru). **Pemutaran banding A/B**: tombol "Putar
  Keduanya (Sinkron)" menjalankan video asli & hasil dari detik 0 bersamaan (gestur klik →
  autoplay dengan suara diizinkan) dengan loop rAF yang menjaga keduanya sejajar (drift
  > 0,12 dtk di-seek ulang, master = sumber; bila salah satu jeda/berakhir, keduanya
  berhenti) — cocok untuk membandingkan audio sebelum/sesudah; tombol mute eksplisit
  (Bisukan/Suarakan) mengendalikan suara kedua pemutar sekaligus. Elemen video panel banding
  terpisah dari video pemrosesan tersembunyi (yang tidak pernah diputar agar drawImage tidak
  men-taint canvas). **Perekaman memakai helper bersama `recordWithAudio`**
  (`src/modules/shared/recordWithAudio.ts`): pola BufferSource → MediaStreamAudioDestinationNode
  (audio `AudioBuffer` diputar ulang saat rekam, track digabung, fallback video saja bila
  muxing audio+video tak didukung, `stop()` membungkus chunk jadi Blob) — diekstrak agar
  modul lain yang merekam canvas (animasi/slideshow) bisa memakainya tanpa menyalin logika.
  Bagian murni (`pickWorkingSize`/`countFrames`/`temporalBlend`/`computePeaks`/
  `processFramePixels`) terpisah dari orkestrasi agar bisa diuji tanpa DOM/video;
  `recordWithAudio` diuji dengan mock MediaRecorder/MediaStream (dengan/ tanpa audio,
  fallback muxing, stop + Blob). **Pipeline per-frame berjalan di Web Worker**: deteksi
  wajah + `enhancePixels` + `temporalBlend` dieksekusi di `faceWorker.ts` (piksel RGBA
  masuk/keluar via transfer, tanpa salin; `prev` koherensi temporal dipegang worker dan
  di-reset via pesan "reset" tiap awal run), sehingga pemrosesan video panjang tidak
  membekukan UI — thread utama hanya seek/draw/getImageData/putImageData yang ringan.
  Logika per-frame dibungkus `processFramePixels` (sumber tunggal: `detectFaceFromPixels`
  — ekstraksi murni dari `detectFace`, downscale area-averaging — dipakai worker DAN
  fallback thread utama), jadi kedua jalur menghasilkan piksel identik. Fallback thread
  utama otomatis bila browser tanpa `Worker`; worker di-terminate saat unmount dengan
  permintaan tertunda ditolak. `detectFaceFromPixels` + `processFramePixels` diuji murni.
  **Sampling frame** (opsi "Sampling frame": Semua/Setengah/Sepertiga — `frameSampling`
  di `VideoEnhanceParams`, tersimpan di localStorage): hanya sebagian frame sumber yang
  diproses (setiap `sf`-slot, `sf` = 2/3) untuk mempercepat video panjang (2×/3×), lalu
  tiap frame hasil **ditahan `sf` slot output** saat rekam — durasi & FPS hasil tetap sama
  persis, hanya kehalusan gerak berkurang. Logika murni `samplingFactor`/`sampledFrames`/
  `sampledBufferIndex` diuji; dipakai fase 1 (jumlah frame diproses), fase 2 & mode live
  (pemetaan slot → buffer frame), dan hitungan frame pada catatan wajah.
- **Edit Auto Layout**: foto bisa di-drag untuk mengatur ulang urutan — antar sel di lembar
  maupun thumbnail di strip (keduanya memakai array foto yang sama, jadi pratinjau, label,
  PDF, dan cetak ikut urutan baru). Bingkai photobox berasal dari
  `photo-studio/shared/frames.ts` (60 bingkai prosedural, 6 kategori:
  Klasik/Polaroid/Vintage/Festif/Modern/Booth — digambar di canvas, tanpa aset eksternal) dan
  diterapkan ke tiap foto di pratinjau, PDF, dan cetak. Kategori Booth (revisi referensi
  template photo booth) membawa elemen signature: bunting, strip hashtag, banner
  "PHOTO BOOTH", washi tape, polka dots, garis pelangi, stempel tanggal, dan viewfinder. Teks bingkai
  bertulisan Booth (strip hashtag & banner) bisa dikustomisasi: satu teks default per event tersimpan
  di localStorage, dan tiap foto bisa diberi teks sendiri (mis. nama tamu) lewat input di strip —
  kosongkan input foto untuk memakai teks default; teks terbake ke pratinjau, PDF, dan cetak. Garis potong putus-putus antar foto
  (default aktif) memudahkan pemotongan setelah cetak — diteruskan ke pratinjau
  (`A4SheetPreview`), ekspor PDF (`buildSheetDoc`), dan cetak HTML (`buildHtmlSheet`).
