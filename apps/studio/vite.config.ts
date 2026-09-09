import { defineConfig } from "vite";
export default defineConfig({
  server: {
    port: 5183,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
