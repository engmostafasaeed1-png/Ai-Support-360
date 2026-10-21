import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "frame-ancestors 'self' https://lovable.dev https://*.lovable.dev https://*.lovable.app https://*.lovableproject.com",
    },
  },
  plugins: [react(), mcpPlugin(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Force every import to resolve to the SAME on-disk copy of React.
      // Prevents "Cannot read properties of null (reading 'useEffect')" caused
      // by duplicate React instances (e.g. nested node_modules or stale cache).
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core", "react-i18next", "i18next"],
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor groups: cached across releases and shared by every area of the app.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return "vendor-react";
          if (id.includes("node_modules/@supabase/")) return "vendor-supabase";
          if (/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(id)) return "vendor-i18n";
          if (id.includes("node_modules/@tanstack/")) return "vendor-query";
          if (/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(id)) return "vendor-charts";
          return undefined;
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
