import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 4512,
  },
  build: {
    target: "esnext",
  },
});
