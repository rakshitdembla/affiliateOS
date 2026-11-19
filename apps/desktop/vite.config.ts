import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "localhost" },
  build: { target: "safari15", sourcemap: false },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true, include: ["src/**/*.test.{ts,tsx}"] },
});
