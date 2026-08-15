import { Component, type ErrorInfo, type ReactNode } from "react";
import { Link } from "react-router-dom";

interface ModuleErrorBoundaryProps {
  children: ReactNode;
}

interface ModuleErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Batas error per modul (pola class component standar). Bila render/lifecycle
 * satu modul melempar, hanya konten modul itu yang diganti kartu error —
 * sidebar/nav dan modul lain tetap berfungsi. Dipasang per rute dengan
 * `key={path}` sehingga berpindah modul me-mount boundary baru (error lama
 * tidak menempel), dan kembali ke modul yang sama mencoba render ulang.
 */
export default class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "Terjadi kesalahan yang tidak diketahui.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Tetap log ke console agar bisa diperiksa; UI tidak ikut mati.
    console.error("[ModuleErrorBoundary] Modul gagal dirender:", error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="module-error" role="alert">
          <span className="module-error-icon">⚠️</span>
          <h2>Modul mengalami kendala</h2>
          <p>
            Terjadi kesalahan saat memuat modul ini. Modul lain tetap berfungsi
            — pilih modul lain dari menu samping, atau muat ulang aplikasi.
          </p>
          <p className="module-error-detail">{this.state.message}</p>
          <div className="module-error-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              🔄 Muat Ulang Aplikasi
            </button>
            <Link to="/" className="btn">
              🏠 Kembali ke Beranda
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
