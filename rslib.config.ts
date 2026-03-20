import { defineConfig } from "@rslib/core";

export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: false,
      dts: true,
      source: {
        entry: {
          index: "src/**",
        },
      },
      output: {
        copy: [{ from: "src/client.d.ts", to: "client.d.ts" }],
      },
    },
  ],
  output: {
    target: "web",
  },
});
