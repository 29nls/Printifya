import { useEffect, useRef, useState } from "react";

interface ResetPreferencesButtonProps {
  /** Dipanggil saat konfirmasi (klik kedua). */
  onReset: () => void;
  /** Teks title / tooltip tombol. */
  title?: string;
}

/**
 * Tombol "Setel Ulang Preferensi" dengan konfirmasi dua-klik (tanpa dialog
 * browser): klik pertama menampilkan "Klik lagi untuk konfirmasi" (armed
 * selama 4 detik), klik kedua menjalankan `onReset`. Aman untuk webview
 * yang tidak mendukung window.confirm.
 */
export default function ResetPreferencesButton({
  onReset,
  title = "Hapus semua kunci localStorage milik modul ini",
}: ResetPreferencesButtonProps) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const click = () => {
    if (!armed) {
      setArmed(true);
      timer.current = window.setTimeout(() => setArmed(false), 4000);
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    setArmed(false);
    onReset();
  };

  return (
    <button type="button" className="btn" title={title} onClick={click}>
      {armed ? "⚠️ Klik lagi untuk konfirmasi" : "🧹 Setel Ulang Preferensi"}
    </button>
  );
}
