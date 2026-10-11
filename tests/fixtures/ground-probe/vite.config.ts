import { defineConfig } from "vite";
export default defineConfig({
  root: "tests/fixtures/ground-probe",
  server: {
    host: "127.0.0.1",
    port: 8792,
    strictPort: true,
    fs: { allow: [process.cwd()] },
  },
});
