import { Suspense } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { LEAF_MODULES, MODULES } from "./modules/registry";
import ModuleErrorBoundary from "./components/ModuleErrorBoundary";
import Home from "./pages/Home";

/** Fallback singkat saat chunk modul sedang diunduh (lazy load). */
function PageLoader() {
  return (
    <div className="page-loader">
      <span className="spinner" aria-hidden="true" />
      <p>Memuat modul…</p>
    </div>
  );
}

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>🖨️</span>
          <span>Printifya</span>
        </div>

        <nav className="nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            🏠 Beranda
          </NavLink>

          {MODULES.map((m) => (
            <div className="nav-group" key={m.id}>
              <div className="nav-group-title">
                <span>{m.icon}</span>
                <span>{m.title}</span>
              </div>
              {m.children?.map((c) => (
                <NavLink
                  key={c.id}
                  to={c.path}
                  className={({ isActive }) =>
                    isActive ? "nav-link active" : "nav-link"
                  }
                >
                  <span>{c.icon}</span>
                  <span>{c.title}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route
              path="/"
              element={
                <ModuleErrorBoundary key="home">
                  <Home />
                </ModuleErrorBoundary>
              }
            />
            {MODULES.map((m) => (
              <Route
                key={m.id}
                path={m.path}
                element={
                  <ModuleErrorBoundary key={m.path}>
                    <m.Component />
                  </ModuleErrorBoundary>
                }
              />
            ))}
            {LEAF_MODULES.map((l) => (
              <Route
                key={l.id}
                path={l.path}
                element={
                  <ModuleErrorBoundary key={l.path}>
                    <l.Component />
                  </ModuleErrorBoundary>
                }
              />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}
