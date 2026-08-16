import { useCallback, useRef, useState } from "react";

/**
 * Guard operasi eksklusif + busy state — pola yang sebelumnya disalin verbatim
 * di Enhance Photo dan Face Enhance (`withBusy`): satu operasi full-res dalam
 * satu waktu (panggilan kedua DITOLAK saat sibuk — `busyRef`), error di-clear
 * saat mulai, error tampil saat gagal (`e.message` atau `defaultError`), busy
 * di-restore di `finally`. State `op` dipakai modul untuk label tombol / hint
 * ("⏳ Memproses…") — JSX tetap per modul karena semantik op berbeda.
 */
export function useExclusiveOp<Op extends string>(
  setError: (message: string) => void,
  defaultError: string
): {
  /** Operasi yang sedang berjalan, atau null. */
  op: Op | null;
  /** true bila ada operasi berjalan (disable tombol). */
  busy: boolean;
  /** Bungkus operasi: `run(op, fn)` → handler yang menolak saat sibuk. */
  run: (op: Op, fn: () => Promise<void>) => () => Promise<void>;
} {
  const [op, setOp] = useState<Op | null>(null);
  const busyRef = useRef(false);
  // `setError` adalah setter useState (stabil) — aman dikunci di callback.
  const run = useCallback(
    (next: Op, fn: () => Promise<void>) =>
      async () => {
        if (busyRef.current) return;
        busyRef.current = true;
        setOp(next);
        setError("");
        try {
          await fn();
        } catch (e) {
          setError(e instanceof Error ? e.message : defaultError);
        } finally {
          busyRef.current = false;
          setOp(null);
        }
      },
    [setError, defaultError]
  );
  return { op, busy: op !== null, run };
}
