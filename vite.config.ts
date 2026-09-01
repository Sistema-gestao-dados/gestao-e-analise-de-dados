import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
    }),
    // Sem "preset" fixo: a Vercel detecta e gera as Vercel Functions
    // automaticamente a partir do plugin Nitro. Para outro provedor
    // (Netlify, Node, etc.), veja https://nitro.build/deploy
    nitro(),
    viteReact(),
  ],
});
