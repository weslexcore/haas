import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  use: { baseURL: "http://localhost:5199" },
  webServer: {
    // Sign-in is off so tests run without a Supabase project.
    command: "VITE_AUTH=off yarn vite --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
  },
  // No device preset: presets spoof the user agent (e.g. Windows), which would make the app's
  // `mod` key disagree with Playwright's host-based ControlOrMeta.
  projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } }],
});
