import { Suspense, useState, useCallback, useEffect } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { LEAF_MODULES, MODULES } from "./modules/registry";
import ModuleErrorBoundary from "./components/ModuleErrorBoundary";
import Home from "./pages/Home";
import { useAutoUpdate } from "./components/useAutoUpdate";
import UpdateDialog from "./components/UpdateDialog";

function PageLoader() {
  return (
    <div className="page-loader">
      <span className="spinner" aria-hidden="true" />
      <p>Memuat modul…</p>
    </div>
  );
}

const GITHUB_OWNER = "29nls";
const GITHUB_REPO = "Printifya";

export default function App() {
  const { hasUpdate, updateInfo, currentVersion, isChecking, checkNow, dismiss, onSkip } =
    useAutoUpdate({ githubOwner: GITHUB_OWNER, githubRepo: GITHUB_REPO });

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((v) => !v);
  }, []);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
  }, []);

  return (
    <div className="app">
      <button
        className="menu-toggle"
        onClick={toggleSidebar}
        aria-label="Toggle menu"
      >
        {sidebarOpen ? "✕" : "☰"}
      </button>

      <div
        className={`sidebar-overlay${sidebarOpen ? " visible" : ""}`}
        onClick={closeSidebar}
      />

      <aside className={`sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">P</div>
          <span className="brand-name">Printifya</span>
        </div>

        <div className="sidebar-scroll">
          <nav className="nav">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              Beranda
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
        </div>

        <div className="sidebar-footer">
          <span className="sidebar-version">v{currentVersion}</span>
          <button
            className="sidebar-check-btn"
            onClick={checkNow}
            disabled={isChecking}
          >
            {isChecking ? (
              <span className="spinner-inline" />
            ) : (
              "🔄"
            )}
            {isChecking ? "Memeriksa…" : "Periksa Update"}
          </button>
        </div>
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

      {hasUpdate && updateInfo && (
        <UpdateDialog
          updateInfo={updateInfo}
          currentVersion={currentVersion}
          onDismiss={dismiss}
          onSkip={onSkip}
        />
      )}
    </div>
  );
}
