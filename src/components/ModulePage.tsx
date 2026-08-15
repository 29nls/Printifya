interface ModulePageProps {
  icon: string;
  title: string;
  description: string;
  features: string[];
}

/**
 * Placeholder halaman modul. Setiap modul di src/modules/<grup>/<modul>/
 * merender komponen ini sampai fitur sebenarnya diimplementasikan.
 */
export function ModulePage({ icon, title, description, features }: ModulePageProps) {
  return (
    <div className="module-page">
      <header className="module-header">
        <span className="module-icon">{icon}</span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>

      <section className="panel">
        <h2>Fitur yang direncanakan</h2>
        <ul className="feature-list">
          {features.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <section className="panel panel-placeholder">
        <h2>Modul dalam pengembangan</h2>
        <p>
          Modul <strong>{title}</strong> sudah terdaftar dalam struktur aplikasi
          dan siap diimplementasikan. Mulai dengan mengisi file{" "}
          <code>index.tsx</code> pada folder modul ini.
        </p>
      </section>
    </div>
  );
}
