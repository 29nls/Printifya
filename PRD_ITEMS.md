# PRD Execution Queue — Printifya

Dokumen ini memetakan seluruh kebutuhan dari `docs/project prd.md` yang **belum selesai** atau **belum ada** di basis kode saat ini (berdasarkan audit kode frontend offline-first Printifya).
File ini dirancang untuk dijalankan oleh **Autonomous AI Agent Loop** dengan kriteria verifikasi deterministik (*machine-decidable*).

---

## Aturan Verifikasi Loop (Autonomous Harness Rules)
1. Setiap item harus diselesaikan secara atomik (satu per satu).
2. Agent dilarang memodifikasi atau memperlemah kriteria verifikasi pada test runner.
3. Judge memeriksa keberhasilan berdasarkan exit code (`0`) dari perintah verifikasi.
4. Jika 3 kali berturut-turut gagal pada satu item, loop wajib berhenti untuk eskalasi ke pengembang manusia.

---

## Fase 1: Rich Text & Document Editing Core (Client-side & Offline)

- [x] ITEM-001: Editor Dokumen — Dukungan Tabel Interaktif di Word Editor
  - **Deskripsi PRD**: Tabel dengan kemampuan tambah baris/kolom, atur border, dan sel pada modul Word Editor (`src/modules/document-studio/word-editor/`).
  - **Boundary**: Tetap mendukung export cetak HTML & PDF tanpa merusak styling font/paragraf yang sudah ada.
  - **Verifikasi**: `npm run test -- -t "word-editor"` atau file unit test tabel dokumen lulus (`exit 0`).

- [x] ITEM-002: Editor Dokumen — Dukungan Sisip Gambar / Watermark Logo di Word Editor
  - **Deskripsi PRD**: Pengguna dapat menyisipkan gambar lokal (Base64/Blob) ke dalam isi dokumen dan mengatur perataannya.
  - **Boundary**: Ukuran gambar harus di-clamp atau dikompresi agar tidak menyebabkan local storage melebihi kuota budget.
  - **Verifikasi**: npx vitest run src/modules/document-studio/word-editor/wordEditorImage.test.ts (`exit 0`).

- [x] ITEM-003: Spreadsheet — Formula Lanjutan & Kompatibilitas Import CSV/XLSX
  - **Deskripsi PRD**: Parser formula spreadsheet mendukung formula dasar finansial/statistik (COUNT, AVERAGE, MIN, MAX) dan impor data CSV langsung ke grid.
  - **Boundary**: Deteksi rekursi/siklus sel harus tetap aktif dan mencegah hang UI.
  - **Verifikasi**: npx vitest run src/modules/document-studio/excel-sheet/spreadsheet.test.ts

- [x] ITEM-004: Editor Dokumen — Ekspor DOCX Client-Side
  - **Deskripsi PRD**: Selain ekspor PDF/HTML, pengguna dapat mengunduh dokumen teks dalam format file `.docx`.
  - **Boundary**: Menggunakan pustaka open-source MIT yang kompatibel dengan browser tanpa ketergantungan server Node.js.
  - **Verifikasi**: npx vitest run src/modules/document-studio/word-editor/docxExport.test.ts

---

## Fase 2: Hardware & Advanced Print Protocols (Print Center)

- [x] ITEM-005: Koneksi Printer — Driver WebUSB / Raw USB Direct Printing
  - **Deskripsi PRD**: Dukungan koneksi printer langsung via WebUSB API (untuk browser Chromium/Android) sebagai alternatif QZ Tray.
  - **Boundary**: Harus memiliki fallback deteksi otomatis jika WebUSB ditolak/tidak didukung oleh OS (misal Windows claim error).
  - **Verifikasi**: npx vitest run src/modules/print-center/webusb/webUsbPrinter.test.ts

- [x] ITEM-006: Koneksi Printer — Driver Web Bluetooth (BLE ESC/POS)
  - **Deskripsi PRD**: Dukungan cetak langsung ke thermal / portable printer via Web Bluetooth API.
  - **Boundary**: Penanganan graceful disconnect & perizinan browser.
  - **Verifikasi**: npx vitest run src/modules/print-center/ble/blePrinter.test.ts

- [x] ITEM-007: Print Center — Real IPP Protocol Packet Builder
  - **Deskripsi PRD**: Saat ini modul printer jaringan hanya menggunakan `no-cors` ping heuristik. Implementasikan packet encoder IPP v1.1/v2.0 murni (Get-Printer-Attributes & Print-Job).
  - **Boundary**: Jika diblokir oleh mixed-content atau CORS browser, arahkan ke proxy lokal / helper secara transparan.
  - **Verifikasi**: npx vitest run src/modules/print-center/network-printer/ippProtocol.test.ts

---

## Fase 3: Image Studio & Processing Enhancements

- [x] ITEM-008: Photo Studio — Filter Warna Lanjutan & Efek Pas Foto (WebGL/Canvas)
  - **Deskripsi PRD**: Pengguna dapat mengubah kecerahan, kontras, saturasi, grayscale, dan filter warm/cool secara real-time pada editor pas foto.
  - **Boundary**: Proses manipulasi piksel harus non-blocking (bisa melalui helper murni atau WebWorker) dan menjaga DPI 300 saat diekspor.
  - **Verifikasi**: npx vitest run src/modules/photo-studio/shared/adjustImageParams.test.ts

- [x] ITEM-009: Photo Studio — Watermark & Metadata Stamping
  - **Deskripsi PRD**: Fitur opsional untuk menyematkan watermark teks/logo studio dan tanggal foto pada sudut cetakan pas foto.
  - **Boundary**: Tidak boleh menutupi area deteksi wajah utama saat rasio pas foto standar dipilih.
  - **Verifikasi**: npx vitest run src/modules/photo-studio/shared/watermarkStamping.test.ts

---

## Fase 4: Cloud Sync, Auth & Backend Integration (Opsional / Client-Server)

- [ ] ITEM-010: Backend / Cloud — Sinkronisasi Template & Riwayat Cloud (Supabase / REST)
  - **Deskripsi PRD**: Opsi bagi pengguna untuk login dan menyimpan arsip dokumen serta riwayat cetak ke backend PostgreSQL/S3.
  - **Boundary**: Mode offline lokal tetap menjadi default utama; sinkronisasi awan adalah fitur opt-in yang tidak memutus alur tanpa internet.
  - **Verifikasi**: Unit test adapter penyimpanan `cloudStorageAdapter.test.ts` (menguji isolasi lokal vs remote saat token auth ada/tidak ada) (`exit 0`).

- [ ] ITEM-011: Multi-User & Audit Logging
  - **Deskripsi PRD**: Pencatatan kuota cetak dan log aktivitas cetak per pengguna (khusus skenario kantor/sekolah).
  - **Boundary**: Data sensitif tidak boleh tercatat secara plain-text dalam audit log.
  - **Verifikasi**: Unit test enkripsi & pembuatan log audit terstruktur (`exit 0`).
