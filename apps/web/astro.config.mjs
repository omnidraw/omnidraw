import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import solid from "@astrojs/solid-js";

export default defineConfig({
  output: "static",
  site: "https://omnidraw.dev",
  integrations: [mdx(), solid()],
  trailingSlash: "never",
});
