import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test/browser",
  workers: 1,
  use: {
    baseURL: "http://localhost:8888",
    browserName: "chromium",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run build && node scripts/dev.mjs",
    url: "http://localhost:8888",
    reuseExistingServer: false,
    env: {
      HERBLAY_ADMIN_CODE: "e2e-only-admin-code",
      HERBLAY_LOCAL_DATA: ".netlify/e2e-" + process.pid,
      HOST: "0.0.0.0",
    },
  },
  reporter: "list",
});
