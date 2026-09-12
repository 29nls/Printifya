import { useEffect, useMemo, useRef, useState } from "react";
import { printHtmlSheet } from "../../print-center/printer-lokal/printHtml";
import { recordPrint } from "../../print-history/printHistoryStorage";
import { exportLetterPdf } from "./letterPdf";
import {
  autoNomor,
  buildLetterHtml,
  formatTanggal,
  splitParagraf,
  type LetterFields,
} from "./letterHtml";
import {
  clearAllStorage,
  clearDraft,
  loadArchive,
  loadDraft,
  loadPaperId,
  makeEntryId,
  pruneArchive,
  saveArchive,
  saveDraft,
  savePaperId,
  type ArchiveEntry,
} from "./storage";
import { downscaleLogo } from "./logoImage";
import type { WriteResult } from "../../shared/versionedStore";
import ResetPreferencesButton from "../../shared/ResetPreferencesButton";
import {
  getPaper,
  PAPER_A4,
  PAPER_SIZES,
  type PaperSize,
} from "../../photo-studio/shared/paperSize";
import "../../photo-studio/shared/style.css";
import "./style.css";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

const DEFAULT_PENUTUP =
  "Demikian surat ini kami sampaikan. Atas perhatian dan kerja samanya, kami ucapkan terima kasih.";

/** Data tersimpan milik versi aplikasi yang lebih baru — jangan ditimpa. */
const LOCKED_MESSAGE =
  "Data tersimpan dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi sebelum mengubah surat agar data tidak tertimpa.";

/** Pesan kegagalan tulis yang bisa ditindaklanjuti pengguna. */
function storageWriteError(result: WriteResult): string {
  if (result.ok) return "";
  return result.reason === "quota"
    ? "Gagal menyimpan: penyimpanan perangkat penuh. Hapus surat lama dari riwayat lalu coba lagi."
    : "Gagal menyimpan: penyimpanan perangkat tidak tersedia atau diblokir.";
}

export default function TemplateSuratPage() {
  const [instansi, setInstansi] = useState("PT Printifya Nusantara");
  const [alamat, setAlamat] = useState("Jl. Merdeka No. 45, Jakarta Pusat 10110");
  const [logo, setLogo] = useState<string | null>(null);
  const [kode, setKode] = useState("PRINTIFYA");
  const [seq, setSeq] = useState(1);
  const [tanggal, setTanggal] = useState(todayIso);
  const [lampiran, setLampiran] = useState("1 berkas");
  const [perihal, setPerihal] = useState("");
  const [kepada, setKepada] = useState("");
  const [isi, setIsi] = useState("");
  const [penutup, setPenutup] = useState(DEFAULT_PENUTUP);
  const [nama, setNama] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [printing, setPrinting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const logoRef = useRef<HTMLInputElement>(null);
  const [hydrated, setHydrated] = useState(false);
  // Dibaca sekali saat mount (sinkron). Hasilnya membawa flag kunci — data
  // ditulis versi aplikasi lebih baru — plus jumlah entri/logo yang disesuaikan
  // migrasi, supaya kehilangan data tidak disajikan sebagai hal normal.
  const [draftLoad] = useState(loadDraft);
  const [archiveLoad] = useState(loadArchive);
  const locked = draftLoad.locked || archiveLoad.locked;
  const [archive, setArchive] = useState<ArchiveEntry[]>(archiveLoad.entries);
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [paper, setPaper] = useState<PaperSize>(() =>
    getPaper(loadPaperId() ?? undefined)
  );

  const fields = useMemo<LetterFields>(
    () => ({
      instansi,
      alamat,
      logo,
      kode,
      seq,
      tanggal,
      lampiran,
      perihal,
      kepada,
      isi,
      penutup,
      nama,
      jabatan,
    }),
    [
      instansi,
      alamat,
      logo,
      kode,
      seq,
      tanggal,
      lampiran,
      perihal,
      kepada,
      isi,
      penutup,
      nama,
      jabatan,
    ]
  );

  const nomor = autoNomor(seq, kode, tanggal);
  const data = { ...fields, nomor };

  const applyFields = (f: LetterFields) => {
    setInstansi(f.instansi);
    setAlamat(f.alamat);
    setLogo(f.logo);
    setKode(f.kode);
    setSeq(f.seq);
    setTanggal(f.tanggal);
    setLampiran(f.lampiran);
    setPerihal(f.perihal);
    setKepada(f.kepada);
    setIsi(f.isi);
    setPenutup(f.penutup);
    setNama(f.nama);
    setJabatan(f.jabatan);
    setError("");
    setInfo("");
  };

  // Pulihkan draf terakhir saat modul dibuka.
  useEffect(() => {
    if (draftLoad.fields) applyFields(draftLoad.fields);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Laporkan apa yang terjadi pada data tersimpan (sekali saat mount): data
  // versi lebih baru, data tidak terbaca, atau penyesuaian yang dilakukan
  // migrasi. Tanpa ini, bagian yang dilepas hilang tanpa jejak.
  useEffect(() => {
    if (locked) {
      setError(LOCKED_MESSAGE);
      return;
    }
    if (draftLoad.unreadable || archiveLoad.unreadable) {
      setError(
        "Sebagian data tersimpan tidak dapat dibaca sehingga tidak dimuat. Surat baru tetap bisa dibuat dan disimpan."
      );
    }
    const notes: string[] = [];
    if (draftLoad.removedLogo) {
      notes.push("logo draf dilepas karena terlalu besar");
    }
    if (archiveLoad.removedLogos > 0) {
      notes.push(
        `${archiveLoad.removedLogos} logo surat dilepas karena terlalu besar`
      );
    }
    if (archiveLoad.evicted > 0) {
      notes.push(
        `${archiveLoad.evicted} surat lama dilepas agar muat penyimpanan`
      );
    }
    if (archiveLoad.dropped > 0) {
      notes.push(`${archiveLoad.dropped} entri riwayat rusak dilewati`);
    }
    if (notes.length > 0) {
      setInfo(`Penyimpanan disesuaikan: ${notes.join(", ")}.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draf (debounce) setelah hydrate selesai. Dilewati sepenuhnya
  // saat data tersimpan milik versi aplikasi yang lebih baru, supaya build
  // lama tidak menimpa data build baru.
  useEffect(() => {
    if (!hydrated || locked) return;
    const t = setTimeout(() => {
      setDraftSaveFailed(!saveDraft(fields).ok);
    }, 500);
    return () => clearTimeout(t);
  }, [fields, hydrated, locked]);

  // Persist ukuran kertas terpilih.
  useEffect(() => savePaperId(paper.id), [paper]);

  // Logo disimpan di draf DAN digandakan ke tiap entri riwayat, jadi berkas
  // dibaca apa adanya sebelumnya bisa menghabiskan kuota localStorage dan
  // membuat penulisan riwayat gagal senyap. Downscale sebelum disimpan.
  const onLogo = async (file?: File | null) => {
    setError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Logo harus berupa gambar (JPG, PNG, atau WebP).");
      return;
    }
    try {
      setLogo(await downscaleLogo(file));
    } catch {
      setError("Logo gagal diproses. Coba gambar lain (JPG atau PNG).");
    }
  };

  const saveToArchive = () => {
    if (locked) {
      setError(LOCKED_MESSAGE);
      return;
    }
    const entry: ArchiveEntry = {
      id: makeEntryId(),
      savedAt: new Date().toISOString(),
      data: fields,
    };
    // Pangkas dulu, baru simpan: state dan storage harus memuat daftar yang
    // sama, dan pesan sukses hanya muncul setelah tulis benar-benar berhasil.
    const next = pruneArchive([entry, ...archive]);
    // Surat BARU bisa ikut terpangkas kalau ukurannya sendiri melebihi anggaran
    // byte. Tanpa pemeriksaan ini pesan sukses muncul sementara surat barunya
    // tidak pernah tersimpan.
    if (!next.some((e) => e.id === entry.id)) {
      setError(
        "Surat tidak tersimpan: ukurannya melebihi batas penyimpanan perangkat. Persingkat isi surat lalu coba lagi."
      );
      return;
    }
    const result = saveArchive(next);
    if (!result.ok) {
      setError(storageWriteError(result));
      return;
    }
    setArchive(next);
    setError("");
    setInfo(
      next.length < archive.length + 1
        ? "Surat tersimpan. Surat lama dilepas agar muat penyimpanan."
        : "Surat tersimpan ke riwayat."
    );
  };

  const loadEntry = (entry: ArchiveEntry) => {
    applyFields(entry.data);
    setInfo(`Memuat surat: ${entry.data.perihal || "(tanpa perihal)"}`);
  };

  const deleteEntry = (id: string) => {
    if (locked) {
      setError(LOCKED_MESSAGE);
      return;
    }
    const next = archive.filter((a) => a.id !== id);
    const result = saveArchive(next);
    if (!result.ok) {
      // Jangan tampilkan seolah terhapus: tanpa tulis yang berhasil, entri
      // akan kembali saat modul dibuka ulang.
      setError(storageWriteError(result));
      return;
    }
    setArchive(next);
    setError("");
  };

  const handleExportPdf = async () => {
    if (exporting || printing) return;
    setError("");
    setInfo("");
    setExporting(true);
    try {
      await exportLetterPdf(data, paper);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat PDF.");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    if (printing || exporting) return;
    setError("");
    setPrinting(true);
    try {
      const html = buildLetterHtml(data, paper);
      const ok = printHtmlSheet(html);
      if (!ok) setError("Tidak bisa membuat iframe cetak di browser ini.");
      recordPrint(perihal || "Surat", paper.name, ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyiapkan cetak.");
      recordPrint(perihal || "Surat", paper.name, false);
    } finally {
      setPrinting(false);
    }
  };

  /** Reset semua data tersimpan (draf & riwayat) + form ke default. */
  const handleResetPrefs = () => {
    clearAllStorage();
    setPaper(PAPER_A4);
    setArchive([]);
    setInstansi("PT Printifya Nusantara");
    setAlamat("Jl. Merdeka No. 45, Jakarta Pusat 10110");
    setLogo(null);
    setKode("PRINTIFYA");
    setSeq(1);
    setTanggal(todayIso());
    setLampiran("1 berkas");
    setPerihal("");
    setKepada("");
    setIsi("");
    setPenutup(DEFAULT_PENUTUP);
    setNama("");
    setJabatan("");
    setError("");
    setInfo("Preferensi & data tersimpan modul ini direset.");
  };

  const newLetter = () => {
    clearDraft();
    setSeq((s) => s + 1);
    setTanggal(todayIso());
    setPerihal("");
    setKepada("");
    setIsi("");
    setPenutup(DEFAULT_PENUTUP);
    setNama("");
    setJabatan("");
    setError("");
    setInfo("");
  };

  const paragraf = splitParagraf(isi);

  return (
    <div className="letter-page-root">
      <header className="module-header">
        <span className="module-icon">✉️</span>
        <div>
          <h1>Template Surat</h1>
          <p>
            Susun surat resmi ber-kop instansi dengan nomor &amp; tanggal
            otomatis, pratinjau cetak live, lalu cetak atau simpan sebagai PDF.
          </p>
        </div>
      </header>

      <div className="letter-layout">
        {/* ---------- Form ---------- */}
        <div className="letter-form">
          <section className="panel">
            <h2>Kop Surat</h2>
            <label className="form-field">
              <span>Nama instansi</span>
              <input
                type="text"
                value={instansi}
                onChange={(e) => setInstansi(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Alamat</span>
              <input
                type="text"
                value={alamat}
                onChange={(e) => setAlamat(e.target.value)}
              />
            </label>
            <div className="form-field">
              <span>Logo</span>
              <div className="logo-row">
                {logo ? (
                  <>
                    <img src={logo} alt="Logo instansi" className="logo-thumb" />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setLogo(null)}
                    >
                      ✕ Hapus
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => logoRef.current?.click()}
                  >
                    🖼️ Upload Logo
                  </button>
                )}
                <input
                  ref={logoRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    onLogo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </section>

          <section className="panel">
            <h2>Nomor &amp; Tanggal</h2>
            <div className="form-row">
              <label className="form-field">
                <span>Kode surat</span>
                <input
                  type="text"
                  value={kode}
                  onChange={(e) => setKode(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Tanggal</span>
                <input
                  type="date"
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value || todayIso())}
                />
              </label>
            </div>
            <div className="auto-nomor">
              <span>
                Nomor otomatis: <strong>{nomor}</strong>
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setSeq((s) => s + 1)}
              >
                🔁 Nomor baru
              </button>
            </div>
          </section>

          <section className="panel">
            <h2>Identitas Surat</h2>
            <label className="form-field">
              <span>Lampiran</span>
              <input
                type="text"
                value={lampiran}
                onChange={(e) => setLampiran(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Perihal</span>
              <input
                type="text"
                value={perihal}
                placeholder="mis. Undangan Rapat"
                onChange={(e) => setPerihal(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Kepada</span>
              <textarea
                rows={2}
                value={kepada}
                placeholder="Yth. Bapak/Ibu …\ndi tempat"
                onChange={(e) => setKepada(e.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <h2>Isi Surat</h2>
            <label className="form-field">
              <span>
                Paragraf isi <em>(pisahkan dengan baris kosong)</em>
              </span>
              <textarea
                rows={7}
                value={isi}
                placeholder={"Dengan ini kami mengundang…\n\n…"}
                onChange={(e) => setIsi(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Penutup</span>
              <textarea
                rows={3}
                value={penutup}
                onChange={(e) => setPenutup(e.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <h2>Penandatangan</h2>
            <label className="form-field">
              <span>Nama</span>
              <input
                type="text"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
              />
            </label>
            <label className="form-field">
              <span>Jabatan</span>
              <input
                type="text"
                value={jabatan}
                onChange={(e) => setJabatan(e.target.value)}
              />
            </label>
          </section>

          <section className="panel">
            <div className="archive-head">
              <h2>Riwayat Surat</h2>
              <div className="archive-actions">
                <ResetPreferencesButton
                  title="Hapus semua data tersimpan modul ini (draf & riwayat surat)"
                  onReset={handleResetPrefs}
                />
                <button type="button" className="btn" onClick={saveToArchive}>
                  💾 Simpan ke Riwayat
                </button>
              </div>
            </div>
            {info && <p className="archive-info">{info}</p>}
            {archive.length === 0 ? (
              <p className="hint">
                Belum ada surat tersimpan. Klik "Simpan ke Riwayat" untuk
                menyimpan surat saat ini; draf juga tersimpan otomatis secara
                lokal dan pulih saat aplikasi dibuka kembali.
              </p>
            ) : (
              <ul className="archive-list">
                {archive.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="archive-item"
                      title="Muat surat ini"
                      onClick={() => loadEntry(a)}
                    >
                      <strong>{a.data.perihal || "(tanpa perihal)"}</strong>
                      <span>
                        {autoNomor(a.data.seq, a.data.kode, a.data.tanggal)} ·{" "}
                        {a.savedAt
                          ? new Date(a.savedAt).toLocaleString("id-ID", {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "tanggal tidak diketahui"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn archive-del"
                      title="Hapus dari riwayat"
                      onClick={() => deleteEntry(a.id)}
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {draftSaveFailed && (
            <p className="error">
              Draf tidak tersimpan otomatis: penyimpanan perangkat penuh. Hapus
              surat lama dari riwayat untuk mengosongkan ruang.
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>

        {/* ---------- Pratinjau A4 ---------- */}
        <div className="letter-preview-col">
          <div className="letter-actions">
            <label className="paper-field">
              <span>Kertas</span>
              <select
                className="tool-select"
                value={paper.id}
                onChange={(e) => setPaper(getPaper(e.target.value))}
              >
                {PAPER_SIZES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={printing || exporting}
              onClick={handlePrint}
            >
              {printing ? "Menyiapkan…" : "🖨️ Cetak / Simpan PDF"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={printing || exporting}
              onClick={handleExportPdf}
            >
              {exporting ? "Menyiapkan PDF…" : "⬇️ Ekspor PDF (.pdf)"}
            </button>
            <button type="button" className="btn" onClick={newLetter}>
              📄 Surat Baru
            </button>
          </div>

          <div className="letter-preview-wrap">
            <div
              className="letter-page"
              style={{
                width: 595,
                minHeight: Math.round(
                  (595 * paper.heightMm) / paper.widthMm
                ),
              }}
            >
              <div className="kop">
                {logo && (
                  <img src={logo} alt="Logo instansi" className="kop-logo" />
                )}
                <div>
                  <div className="kop-instansi">{instansi || "—"}</div>
                  <div className="kop-alamat">{alamat}</div>
                </div>
              </div>
              <div className="kop-line" />

              <div className="meta">
                <p>
                  <span className="meta-field">Nomor</span>: {nomor}
                </p>
                <p>
                  <span className="meta-field">Lampiran</span>: {lampiran}
                </p>
                <p>
                  <span className="meta-field">Perihal</span>: {perihal}
                </p>
                <p className="kepada">
                  <span className="meta-field">Kepada</span>:{" "}
                  {kepada.split("\n").map((l, i) => (
                    <span key={i}>
                      {l}
                      {i < kepada.split("\n").length - 1 && <br />}
                    </span>
                  ))}
                </p>
              </div>

              <p className="salam">Dengan hormat,</p>

              {paragraf.length > 0 ? (
                paragraf.map((p, i) => <p key={i} className="body-p">{p}</p>)
              ) : (
                <p className="body-p placeholder-text">
                  Isi surat akan tampil di sini…
                </p>
              )}

              <p className="penutup">{penutup}</p>

              <div className="ttd">
                <div className="ttd-jabatan">{jabatan}</div>
                <div className="ttd-tanggal">{formatTanggal(tanggal)}</div>
                <div className="ttd-space" />
                <div className="ttd-nama">{nama}</div>
              </div>
            </div>
          </div>

          <p className="hint">
            💡 Nomor &amp; tanggal otomatis mengikuti kode dan tanggal yang
            dipilih. Pratinjau = tampilan cetak {paper.name} (diskalakan);
            tombol cetak membuka dialog browser untuk mencetak atau menyimpan
            PDF dengan kertas {paper.name}.
          </p>
        </div>
      </div>
    </div>
  );
}
