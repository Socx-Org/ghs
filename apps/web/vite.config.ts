/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// ghs#62: local dev proxies both /api (versioned application API,
// ghs#57) and /healthz (deliberately unversioned) to the real API
// process on its own default port (config.ts's own PORT default) --
// no path rewriting, matching the same rule the real deployed nginx
// config (deploy/nginx-ghs.conf) already follows for the identical
// reason (CS-INF-010's real, confirmed outage from exactly that).
const API_TARGET = "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
      "/healthz": { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    allowedHosts: ["ghs.socx.org.uk", "localhost", "127.0.0.1"],
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
  },
});
