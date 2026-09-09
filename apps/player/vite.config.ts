import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  server: {
    port: 5184,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
