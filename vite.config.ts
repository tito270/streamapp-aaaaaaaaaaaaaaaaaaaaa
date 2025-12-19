import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,

    // ✅ Proxy ONLY in development
    proxy:
      mode === "development"
        ? {
            "/start-stream": { target: "http://127.0.0.1:3001", changeOrigin: true },
            "/stop-stream": { target: "http://127.0.0.1:3001", changeOrigin: true },
            "/calculate-bitrate": { target: "http://127.0.0.1:3001", changeOrigin: true },
            "/bitrate-history": { target: "http://127.0.0.1:3001", changeOrigin: true },
            "/events": { target: "http://127.0.0.1:3001", changeOrigin: true },
            "/live": { target: "http://127.0.0.1:8000", changeOrigin: true },
          }
        : undefined,
  },

  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules")) {
            if (id.includes("recharts")) return "vendor-recharts";
            if (id.includes("video.js")) return "vendor-videojs";
            if (id.includes("hls.js")) return "vendor-hls";
            return "vendor";
          }
        },
      },
    },
  },
}));
