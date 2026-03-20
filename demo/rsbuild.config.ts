import { defineConfig } from "@rsbuild/core";
import arborium from "unplugin-arborium/rspack";

export default defineConfig({
  tools: {
    rspack: {
      plugins: [
        arborium({
          languages: ["json"],
        }),
      ],
    },
  },
  source: {
    entry: {
      index: "./src/main.ts",
    },
  },
  html: {
    template: "./index.html",
  },
});
