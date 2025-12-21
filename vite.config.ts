import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const normalizeBase = (v?: string) => (v ? v.replace(/\/+$/, "") : "");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // ✅ In Lovable: set these in Project Env Vars
  // ✅ In local dev: you can also set them, otherwise defaults below will be used
  const API_BASE =
    normalizeBase(env.VITE_API_BASE) || (mode === "development" ? "http://127.0.0.1:3001" : "");

  const HLS_BASE =
    normalizeBase(env.VITE_HLS_BASE) || (mode === "development" ? "http://127.0.0.1:8000" : "");

  // Proxy only makes sense for `vite dev` (local dev server)
  const enableProxy = mode === "development" && (API_BASE || HLS_BASE);

  return {
    server: {
      host: "::",
      port: 8080,

      // ✅ DEV proxy (not used in production build)
      proxy: enableProxy
        ? {
            ...(API_BASE
              ? {
                  "/start-stream": { target: API_BASE, changeOrigin: true, secure: false },
                  "/stop-stream": { target: API_BASE, changeOrigin: true, secure: false },
                  "/calculate-bitrate": { target: API_BASE, changeOrigin: true, secure: false },
                  "/bitrate-history": { target: API_BASE, changeOrigin: true, secure: false },
                  "/events": { target: API_BASE, changeOrigin: true, secure: false },

                  // ✅ your logs endpoints (StreamManager uses these)
                  "/api": { target: API_BASE, changeOrigin: true, secure: false },
                  "/download-log": { target: API_BASE, changeOrigin: true, secure: false },
                }
              : {}),

            ...(HLS_BASE
              ? {
                  "/live": { target: HLS_BASE, changeOrigin: true, secure: false },
                }
              : {}),
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
  };
});
