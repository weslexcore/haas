/// <reference types="vitest/config" />
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Cross-origin isolation: LibRaw's WebAssembly uses threads, which need
 * SharedArrayBuffer. Production hosting must send the same headers on every
 * response.
 */
const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/**
 * Sends the isolation headers on every response of the dev and preview
 * servers. Vite's own `server.headers` option skips 304 Not Modified (and
 * some static files), and a module the browser revalidates from its cache
 * without them can't be loaded into a worker: Safari then shows no
 * thumbnails at all, and no browser can decode RAW.
 */
function isolationHeaders(): Plugin {
  const middleware: Connect.NextHandleFunction = (_req, res, next) => {
    for (const [name, value] of Object.entries(ISOLATION_HEADERS)) res.setHeader(name, value);
    next();
  };
  return {
    name: "isolation-headers",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  // Pre-bundle up front so the dev server never reloads the page mid-session to add them.
  optimizeDeps: { include: ["dexie", "exifr", "@tanstack/react-virtual", "match-sorter", "zod", "immer", "zustand"],
    // Loads its worker and .wasm relative to its own files, which pre-bundling would break.
    exclude: ["libraw-wasm"],
  },
  worker: { format: "es" },
  plugins: [
    isolationHeaders(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Photon",
        short_name: "Photon",
        description: "Cull, develop and export photos in your browser",
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
