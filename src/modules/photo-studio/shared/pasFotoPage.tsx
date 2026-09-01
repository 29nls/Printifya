import { useEffect, useState, type ComponentType } from "react";
import PasFotoWorkflow from "./PasFotoWorkflow";
import type { PasFotoSize } from "./pasFotoSize";
import {
  clearPendingPasFoto,
  peekPendingPasFoto,
} from "../../shared/pasFotoBridge";

/**
 * Factory: given a PasFotoSize, return a ready-to-mount page component.
 * Eliminates the copy-paste across pas-foto-2x3, 3x4, 4x6 index.tsx files.
 */
export function pasFotoPage(size: PasFotoSize): ComponentType {
  return function PasFotoPage() {
    const [initialImage] = useState(() => peekPendingPasFoto());

    useEffect(() => {
      clearPendingPasFoto();
    }, []);

    return (
      <PasFotoWorkflow size={size} initialImage={initialImage ?? undefined} />
    );
  };
}
