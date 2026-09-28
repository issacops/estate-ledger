import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
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
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    alias: {
      "@tauri-apps/plugin-sql": resolve(__dirname, "src/test/fakes/plugin-sql.ts"),
      "@tauri-apps/api/core": resolve(__dirname, "src/test/fakes/core.ts"),
      "@tauri-apps/plugin-dialog": resolve(
        __dirname,
        "src/test/fakes/plugin-dialog.ts"
      ),
      "@tauri-apps/plugin-fs": resolve(__dirname, "src/test/fakes/plugin-fs.ts"),
      "@tauri-apps/plugin-opener": resolve(
        __dirname,
        "src/test/fakes/plugin-fs.ts"
      ),
    },
  },
}));
