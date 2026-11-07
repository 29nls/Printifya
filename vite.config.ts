import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Worker sebagai ES module: semua pemakai membuat worker dengan
  // `{ type: "module" }`, dan format es mendukung code-splitting — worker
  // ekspor PDF mengimpor jsPDF yang berisi dynamic import (html2canvas dll),
  // yang tidak bisa di-bundle dalam format iife.
  worker: { format: "es" },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router-dom")
            ) {
              return "vendor-react";
            }
            if (id.includes("pdf-lib")) {
              return "vendor-pdf-lib";
            }
            if (id.includes("jspdf")) {
              return "vendor-jspdf";
            }
            if (id.includes("@capacitor")) {
              return "vendor-capacitor";
            }
            if (id.includes("cropperjs")) {
              return "vendor-cropper";
            }
            if (id.includes("qrcode")) {
              return "vendor-qrcode";
            }
          }
        },
      },
    },
  },
});
