import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: new URL("./index.html", import.meta.url).pathname,
            redirect: new URL("./redirect.html", import.meta.url).pathname,
          },
        },
      },
    },
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
});



