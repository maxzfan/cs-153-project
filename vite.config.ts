import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";
import { ValidateEnv } from "@julr/vite-plugin-validate-env";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "localhost",
    port: 5173,
  },
  plugins: [
    // Validate VITE_* env vars at build time — fails loud on missing or
    // malformed secrets so CI never silently embeds empty strings into
    // the bundle. Schema lives in ./env.ts (the single source of truth).
    ValidateEnv(),
    react(),
    mode === "development" && componentTagger(),
    mode === "production" && visualizer({ open: false, filename: "dist/bundle-stats.html", gzipSize: true }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Exclude rhino3dm from pre-bundling - it's loaded from CDN via Three.js loader
    exclude: ["rhino3dm"],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      // Mark rhino3dm and ws as external - rhino3dm is loaded from CDN
      external: ["rhino3dm", "ws"],
      output: {
        manualChunks(id) {
          // Three.js + react-three ecosystem — only needed in the 3D viewer
          if (
            id.includes("node_modules/three/") ||
            id.includes("node_modules/@react-three/") ||
            id.includes("node_modules/@threlte/")
          ) {
            return "vendor-three";
          }
          // Radix UI + animation utilities — shared UI primitives
          if (
            id.includes("node_modules/@radix-ui/") ||
            id.includes("node_modules/class-variance-authority") ||
            id.includes("node_modules/tailwind-merge") ||
            id.includes("node_modules/clsx")
          ) {
            return "vendor-ui";
          }
          // Supabase + auth
          if (id.includes("node_modules/@supabase/")) {
            return "vendor-supabase";
          }
        },
      },
    },
  },
  // Electron specific configuration
  base: mode === 'development' ? '/' : './',
}));
