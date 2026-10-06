import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir:      "dist",
    sourcemap:   false,
    minify:      "esbuild",
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          react:     ["react", "react-dom"],
        },
      },
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target:      "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
