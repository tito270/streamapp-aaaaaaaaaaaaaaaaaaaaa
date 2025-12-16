import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  server: {
    host: true, // allow LAN access
    port: 8080,
    proxy: {
      '/start-stream':      { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/stop-stream':       { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/calculate-bitrate': { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/bitrate-history':   { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/events':            { target: 'http://127.0.0.1:3001', changeOrigin: true },
      '/live':              { target: 'http://127.0.0.1:8000', changeOrigin: true },
    }
  },
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Manual chunking to avoid very large single bundles.
  // Splits heavy libraries into their own vendor chunks so the app can lazy-load other parts.
  build: {
    // Raise warning a bit to reduce noisy warnings during development; still keep a limit.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            // split out charting lib
            if (id.includes('recharts')) return 'vendor-recharts';
            // video libraries
            if (id.includes('video.js')) return 'vendor-videojs';
            if (id.includes('hls.js')) return 'vendor-hls';
            // common vendor chunk for everything else in node_modules
            return 'vendor';
          }
        }
      }
    }
  }
});
