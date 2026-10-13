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
  ...(mode === "production"
    ? {
        build: { sourcemap: false, minify: "esbuild" as const },
        esbuild: { drop: ["console", "debugger"] as ("console" | "debugger")[], legalComments: "none" as const },
      }
    : {}),
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
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
