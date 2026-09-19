import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`, and everything else that is
      //    written *while* the dev window is open but is not app source. An e2e
      //    run, a screenshot pass or a docs edit used to reload the window out
      //    from under whoever was looking at it — and a reload mid-run is also
      //    how a Playwright spec fails for no reason.
      ignored: [
        "**/src-tauri/**",
        // Playwright's per-run cache and the screenshots the specs write.
        "**/tests/e2e-mac/.cache/**",
        // Every throwaway build output: dist-shell, dist-recon, dist-settings…
        "**/dist-*/**",
        // The design agent's gallery renders and contrast audits.
        "**/design/**",
        // Notes. Nothing here is imported by the app.
        "**/docs/**",
      ],
    },
  },
}));
