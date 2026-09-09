import { defineConfig } from "vite";
export default defineConfig({
  build: {
    ssr: "apps/server/src/index.ts",
    outDir: "apps/server/dist",
    target: "node22",
    emptyOutDir: true,
  },
});
