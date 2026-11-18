import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const apiPaths = ["/health", "/stats", "/config", "/v1", "/v1beta", "/api"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const gateway = env.MAGPIE_GATEWAY_URL || "http://127.0.0.1:3426";

  return {
    plugins: [react()],
    base: "/",
    server: {
      proxy: Object.fromEntries(apiPaths.map((path) => [path, { target: gateway, changeOrigin: true }])),
    },
    build: { outDir: "dist", emptyOutDir: true },
  };
});
