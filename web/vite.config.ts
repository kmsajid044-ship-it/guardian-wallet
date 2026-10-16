import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { assertNoDemoKeyInBuild } from "./env-guard.ts";

// Single .env at the repo root (see .env.example).
const envDir = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ command, mode }) => {
  // loadEnv merges .env files with VITE_* variables from the shell environment.
  assertNoDemoKeyInBuild(command, loadEnv(mode, envDir, "VITE_"));

  return {
    envDir,
    // The exact JSON written by the Foundry deploy script is served as public, non-secret configuration.
    publicDir: fileURLToPath(new URL("../deployments", import.meta.url)),
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
  };
});
