import { describe, it, expect } from "@rstest/core";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { unplugin, fromNodeModules } from "../dist/index.js";
import type { ArboriumPluginOptions, GrammarResolver } from "../dist/index.d.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureEntry = path.resolve(__dirname, "fixtures/entry.js");
const outDir = path.resolve(__dirname, ".out");

const pluginOptions: ArboriumPluginOptions = {};

function cleanOutDir() {
  fs.rmSync(outDir, { recursive: true, force: true });
}

describe("unplugin-arborium", () => {
  describe("vite", () => {
    it("builds and emits wasm assets", async () => {
      const viteOutDir = path.join(outDir, "vite");
      const { build } = await import("vite");

      await build({
        root: __dirname,
        logLevel: "silent",
        plugins: [unplugin.vite(pluginOptions)],
        build: {
          outDir: viteOutDir,
          rollupOptions: {
            input: fixtureEntry,
          },
          // Don't copy public dir
          copyPublicDir: false,
        },
      });

      const files = listFilesRecursive(viteOutDir);
      const wasmFiles = files.filter((f) => f.endsWith(".wasm"));
      const jsFiles = files.filter((f) => f.endsWith(".js"));

      expect(wasmFiles.length).toBeGreaterThanOrEqual(2); // host + json grammar
      expect(jsFiles.length).toBeGreaterThanOrEqual(1);

      // Verify JS output references the wasm assets
      const jsContent = jsFiles
        .map((f) => fs.readFileSync(f, "utf-8"))
        .join("\n");
      expect(jsContent).toContain(".wasm");

      cleanOutDir();
    });
  });

  describe("rollup", () => {
    it("builds and resolves virtual module", async () => {
      const { rollup } = await import("rollup");

      const bundle = await rollup({
        input: fixtureEntry,
        plugins: [unplugin.rollup(pluginOptions)],
        // Externalize everything except our virtual module
        external: (id) => {
          if (id === "arborium" || id.startsWith("\0")) return false;
          // Let the plugin resolve arborium imports
          return !id.includes("@arborium");
        },
        logLevel: "silent",
      });

      const { output } = await bundle.generate({ format: "esm" });
      await bundle.close();

      const code = output
        .filter(
          (chunk): chunk is (typeof output)[0] & { code: string } =>
            chunk.type === "chunk",
        )
        .map((chunk) => chunk.code)
        .join("\n");

      // Virtual module was resolved and the public API is present
      expect(code).toContain("getAvailableLanguages");
      expect(code).toContain("isLanguageAvailable");
    });
  });

  describe("webpack", () => {
    it("builds successfully", async () => {
      const webpackOutDir = path.join(outDir, "webpack");
      const webpack = (await import("webpack")).default;

      const stats = await new Promise<any>((resolve, reject) => {
        webpack(
          {
            mode: "production",
            entry: fixtureEntry,
            output: {
              path: webpackOutDir,
              filename: "bundle.js",
              library: { type: "module" },
            },
            experiments: { outputModule: true },
            plugins: [unplugin.webpack(pluginOptions)],
          },
          (err, stats) => {
            if (err) reject(err);
            else resolve(stats);
          },
        );
      });

      expect(stats.hasErrors()).toBe(false);

      const files = listFilesRecursive(webpackOutDir);
      const wasmFiles = files.filter((f) => f.endsWith(".wasm"));
      expect(wasmFiles.length).toBeGreaterThanOrEqual(2);

      cleanOutDir();
    });
  });

  describe("rspack", () => {
    it("builds successfully", async () => {
      const rspackOutDir = path.join(outDir, "rspack");
      const rspack = (await import("@rspack/core")).rspack;

      const stats = await new Promise<any>((resolve, reject) => {
        rspack(
          {
            mode: "production",
            entry: fixtureEntry,
            output: {
              path: rspackOutDir,
              filename: "bundle.js",
              library: { type: "module" },
            },
            experiments: { outputModule: true },
            plugins: [unplugin.rspack(pluginOptions)],
          },
          (err: any, stats: any) => {
            if (err) reject(err);
            else resolve(stats);
          },
        );
      });

      expect(stats.hasErrors()).toBe(false);

      const files = listFilesRecursive(rspackOutDir);
      const wasmFiles = files.filter((f) => f.endsWith(".wasm"));
      expect(wasmFiles.length).toBeGreaterThanOrEqual(2);

      cleanOutDir();
    });
  });

  describe("esbuild", () => {
    it("builds and resolves virtual module", async () => {
      const esbuildOutDir = path.join(outDir, "esbuild");
      const esbuild = await import("esbuild");

      const result = await esbuild.build({
        entryPoints: [fixtureEntry],
        bundle: true,
        outdir: esbuildOutDir,
        format: "esm",
        plugins: [unplugin.esbuild(pluginOptions)],
        logLevel: "silent",
        // esbuild can't resolve @arborium/arborium from the virtual module,
        // so mark it external
        external: ["@arborium/arborium"],
      });

      expect(result.errors.length).toBe(0);

      const files = listFilesRecursive(esbuildOutDir);
      const jsFiles = files.filter((f) => f.endsWith(".js"));
      expect(jsFiles.length).toBeGreaterThanOrEqual(1);

      const jsContent = jsFiles
        .map((f) => fs.readFileSync(f, "utf-8"))
        .join("\n");
      expect(jsContent).toContain("getAvailableLanguages");

      cleanOutDir();
    });
  });
});

// ============================================================================
// Language resolution in buildStart
// ============================================================================

describe("language resolution", () => {
  it("emits a warning and returns early when discoverLanguages returns an empty array", async () => {
    const resolver = fromNodeModules();
    resolver.discoverLanguages = async () => [];
    const vitePlugin = unplugin.vite({ resolve: resolver });

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => warnings.push(msg);
    try {
      await (vitePlugin as any).buildStart?.();
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("no languages found");
  });
});

/** Recursively list all files in a directory */
function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFilesRecursive(fullPath) : [fullPath];
  });
}
