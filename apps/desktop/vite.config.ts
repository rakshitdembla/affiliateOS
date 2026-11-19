import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "localhost" },
  build: { target: "safari15", sourcemap: false },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], globals: true },
});
