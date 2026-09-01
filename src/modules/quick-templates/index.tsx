import { useState } from "react";
import "./style.css";

interface Template {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: string;
  fields: { label: string; type: "text" | "textarea" | "date" | "number" }[];
}

const TEMPLATES: Template[] = [
  {
    id: "kwitansi",
    name: "Kwitansi",
    icon: "🧾",
    description: "Kwitansi pembayaran sederhana",
    category: "Keuangan",
    fields: [
      { label: "Dari", type: "text" },
      { label: "Untuk", type: "text" },
      { label: "Jumlah (Rp)", type: "number" },
      { label: "Keterangan", type: "textarea" },
      { label: "Tanggal", type: "date" },
    ],
  },
  {
    id: "surat-pernyataan",
    name: "Surat Pernyataan",
    icon: "📝",
    description: "Surat pernyataan bermaterai",
    category: "Surat",
    fields: [
      { label: "Yang menyatakan", type: "text" },
      { label: "NIK", type: "text" },
      { label: "Isi pernyataan", type: "textarea" },
      { label: "Tanggal", type: "date" },
      { label: "Kota", type: "text" },
    ],
  },
  {
    id: "surat-domisili",
    name: "Surat Domisili",
    icon: "🏠",
    description: "Surat keterangan domisili dari RT/RW",
    category: "Surat",
    fields: [
      { label: "Nama", type: "text" },
      { label: "NIK", type: "text" },
      { label: "Alamat lengkap", type: "textarea" },
      { label: "RT/RW", type: "text" },
      { label: "Kelurahan/Desa", type: "text" },
      { label: "Kecamatan", type: "text" },
      { label: "Tanggal", type: "date" },
    ],
  },
  {
    id: "label-folder",
    name: "Label Folder",
    icon: "📁",
    description: "Label untuk folder arsip",
    category: "Label",
    fields: [
      { label: "Judul", type: "text" },
      { label: "Kode/Kategori", type: "text" },
      { label: "Tanggal", type: "date" },
    ],
  },
  {
    id: "kartu-nama",
    name: "Kartu Nama",
    icon: "💼",
    description: "Kartu nama sederhana (ukuran kartu)",
    category: "Kartu",
    fields: [
      { label: "Nama", type: "text" },
      { label: "Jabatan", type: "text" },
      { label: "Telepon", type: "text" },
      { label: "Email", type: "text" },
      { label: "Alamat", type: "textarea" },
    ],
  },
  {
    id: "bon-peminjaman",
    name: "Bon Peminjaman",
    icon: "📋",
    description: "Bon peminjaman barang/uang",
    category: "Keuangan",
    fields: [
      { label: "Peminjam", type: "text" },
      { label: "Barang/Uang", type: "text" },
      { label: "Jumlah", type: "number" },
      { label: "Jatuh tempo", type: "date" },
      { label: "Keterangan", type: "textarea" },
      { label: "Tanggal", type: "date" },
    ],
  },
  {
    id: "form-biodata",
    name: "Formulir Biodata",
    icon: "🪪",
    description: "Formulir pengisian biodata",
    category: "Formulir",
    fields: [
      { label: "Nama Lengkap", type: "text" },
      { label: "Tempat/Tanggal Lahir", type: "text" },
      { label: "Jenis Kelamin", type: "text" },
      { label: "Agama", type: "text" },
      { label: "Alamat", type: "textarea" },
      { label: "Telepon", type: "text" },
      { label: "Pekerjaan", type: "text" },
    ],
  },
  {
    id: "tanda-terima",
    name: "Tanda Terima",
    icon: "✅",
    description: "Tanda terima barang/dokumen",
    category: "Keuangan",
    fields: [
      { label: "Dari", type: "text" },
      { label: "Untuk", type: "text" },
      { label: "Barang/Dokumen", type: "textarea" },
      { label: "Tanggal", type: "date" },
      { label: "Catatan", type: "textarea" },
    ],
  },
];

export default function QuickTemplatesPage() {
  const [selected, setSelected] = useState<Template | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const handleSelect = (t: Template) => {
    setSelected(t);
    setFormData({});
    setError("");
  };

  const handleChange = (label: string, value: string) => {
    setFormData((prev) => ({ ...prev, [label]: value }));
  };

  /** Generate PDF from template */
  const generatePdf = async () => {
    if (!selected) return;
    setGenerating(true);
    setError("");
    try {
      const { default: jsPDF } = await import("jspdf");
      const pdf = new jsPDF("p", "mm", "a4");

      // Title
      pdf.setFontSize(16);
      pdf.setFont("helvetica", "bold");
      pdf.text(selected.name.toUpperCase(), 105, 25, { align: "center" });

      // Line separator
      pdf.setLineWidth(0.5);
      pdf.line(20, 30, 190, 30);

      // Fields
      let y = 45;
      pdf.setFontSize(11);

      for (const field of selected.fields) {
        const value = formData[field.label] || "________________________";

        pdf.setFont("helvetica", "bold");
        pdf.text(`${field.label}:`, 25, y);
        pdf.setFont("helvetica", "normal");

        if (field.type === "textarea") {
          const lines = pdf.splitTextToSize(value, 140);
          pdf.text(lines, 70, y);
          y += lines.length * 6;
        } else {
          pdf.text(value, 70, y);
        }
        y += 10;
      }

      // Signature area
      y = Math.max(y + 20, 200);
      pdf.setFont("helvetica", "normal");
      pdf.text("Mengetahui,", 30, y);
      pdf.text("Yang menyatakan,", 150, y);
      y += 25;
      pdf.line(30, y, 80, y);
      pdf.line(150, y, 200, y);

      // Date
      const date = formData["Tanggal"] || new Date().toISOString().slice(0, 10);
      pdf.text(date, 190, 280, { align: "right" });

      pdf.save(`${selected.id}.pdf`);
    } catch {
      setError("Gagal membuat PDF");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="templates-page">
      <header className="module-header">
        <span className="module-icon">📑</span>
        <div>
          <h1>Template Cepat</h1>
          <p>Template siap pakai: kwitansi, surat, label, formulir, dan lainnya</p>
        </div>
      </header>

      {!selected ? (
        <div className="templates-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="template-card"
              onClick={() => handleSelect(t)}
            >
              <span className="template-icon">{t.icon}</span>
              <div className="template-info">
                <h3>{t.name}</h3>
                <p>{t.description}</p>
                <span className="template-category">{t.category}</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="template-form">
          <div className="template-form-header">
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              ← Kembali
            </button>
            <h2>{selected.icon} {selected.name}</h2>
          </div>

          <div className="panel">
            {selected.fields.map((field) => (
              <label key={field.label} className="form-field">
                <span>{field.label}</span>
                {field.type === "textarea" ? (
                  <textarea
                    value={formData[field.label] ?? ""}
                    onChange={(e) => handleChange(field.label, e.target.value)}
                    rows={3}
                    placeholder={`Masukkan ${field.label.toLowerCase()}…`}
                  />
                ) : (
                  <input
                    type={field.type}
                    value={formData[field.label] ?? ""}
                    onChange={(e) => handleChange(field.label, e.target.value)}
                    placeholder={
                      field.type === "date"
                        ? new Date().toISOString().slice(0, 10)
                        : `Masukkan ${field.label.toLowerCase()}…`
                    }
                  />
                )}
              </label>
            ))}
          </div>

          {error && <p className="error">{error}</p>}

          <div className="template-actions">
            <button type="button" className="btn btn-primary" onClick={generatePdf} disabled={generating}>
              {generating ? "Membuat…" : "📄 Ekspor PDF"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
