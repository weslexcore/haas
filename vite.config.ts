/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Cross-origin isolation: LibRaw's WebAssembly uses threads, which need
 * SharedArrayBuffer. Production hosting must send the same headers.
 */
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: ISOLATION_HEADERS },
  preview: { headers: ISOLATION_HEADERS },
  // Pre-bundle up front so the dev server never reloads the page mid-session to add them.
  optimizeDeps: { include: ["dexie", "exifr", "@tanstack/react-virtual", "match-sorter", "zod", "immer", "zustand"],
    // Loads its worker and .wasm relative to its own files, which pre-bundling would break.
    exclude: ["libraw-wasm"],
  },
  worker: { format: "es" },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Photo",
        short_name: "Photo",
        description: "Browser-based photo culling and editing",
        theme_color: "#16181d",
        background_color: "#16181d",
        display: "standalone",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
