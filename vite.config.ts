import { defineConfig } from "vite";

const cursorProxy = {
  "/v1": {
    target: "https://api.cursor.com",
    changeOrigin: true,
    secure: true,
  },
} as const;

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { ...cursorProxy },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { ...cursorProxy },
  },
});

