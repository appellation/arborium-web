import { defineConfig } from "@rstest/core";

export default defineConfig({
  testTimeout: 30000,
  output: {
    externals: [/unplugin-arborium/, /\.\/dist\//],
  },
});
