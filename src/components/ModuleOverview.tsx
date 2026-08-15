import { Link } from "react-router-dom";
import { MODULES } from "../modules/registry";

export default function ModuleOverview({ moduleId }: { moduleId: string }) {
  const mod = MODULES.find((m) => m.id === moduleId);
  if (!mod) return null;

  return (
    <div className="module-overview">
      <header className="module-header">
        <span className="module-icon">{mod.icon}</span>
        <div>
          <h1>{mod.title}</h1>
          <p>{mod.description}</p>
        </div>
      </header>

      <div className="card-grid">
        {mod.children?.map((c) => (
          <Link key={c.id} to={c.path} className="card">
            <span className="card-icon">{c.icon}</span>
            <h3>{c.title}</h3>
            <p>{c.description}</p>
            <span className="card-cta">Buka modul →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
