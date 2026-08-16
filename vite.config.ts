import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Worker sebagai ES module: semua pemakai membuat worker dengan
  // `{ type: "module" }`, dan format es mendukung code-splitting — worker
  // ekspor PDF mengimpor jsPDF yang berisi dynamic import (html2canvas dll),
  // yang tidak bisa di-bundle dalam format iife.
  worker: { format: "es" },
});
