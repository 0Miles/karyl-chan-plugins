import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { viteSingleFile } from "vite-plugin-singlefile";

// Same inline-everything pattern as the radio plugin's WebUI: one
// self-contained index.html so the bot's CSP doesn't need per-asset
// exceptions and the WebUI ships as a single artifact.
export default defineConfig({
  plugins: [vue(), viteSingleFile()],
  root: "web",
  build: {
    outDir: "../dist/ui",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
