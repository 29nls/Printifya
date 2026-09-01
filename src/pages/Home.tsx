import { Link } from "react-router-dom";
import { MODULES } from "../modules/registry";

export default function Home() {
  return (
    <div className="home">
      <header className="hero">
        <h1>Printifya</h1>
        <p>
          Pas foto, dokumen, dan pencetakan — langsung dari aplikasi.
        </p>
      </header>

      <div className="card-grid">
        {MODULES.map((m) => (
          <Link key={m.id} to={m.path} className="card">
            <span className="card-icon">{m.icon}</span>
            <h3>{m.title}</h3>
            <p>{m.description}</p>
            <span className="card-cta">Buka →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
