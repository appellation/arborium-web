import { fileURLToPath } from "node:url";
import { createUnplugin } from "unplugin";
import type { ArboriumPluginOptions } from "./types.js";
import { fromNodeModules, resolveHost } from "./core/resolvers.js";
import { generateRuntimeModule } from "./core/codegen.js";
import { checkLicenses } from "./core/licenses.js";

const VIRTUAL_RUNTIME_ID = "arborium";
const VIRTUAL_RUNTIME_ALT = "arborium/runtime";
const RESOLVED_VIRTUAL_ID = "\0arborium:runtime";
const THEME_PREFIX = "arborium/themes/";

export const unpluginFactory = (options: ArboriumPluginOptions = {}) => {
  const grammarResolver = options.resolve ?? fromNodeModules();
  let generatedCode: string | null = null;

  return {
    name: "unplugin-arborium",
    enforce: "pre" as const,

    async buildStart() {
      const languages = await grammarResolver.discoverLanguages();
      if (languages.length === 0) {
        console.warn(
          "unplugin-arborium: no languages found. Install @arborium/<lang> packages or use fromNpm().",
        );
        return;
      }

      await checkLicenses(languages, options.allowedLicenses);
      const host = resolveHost();
      const resolved = await grammarResolver({ languages });
      generatedCode = generateRuntimeModule(host, resolved);
    },

    resolveId(id: string, importer: string | undefined) {
      if (id === VIRTUAL_RUNTIME_ID || id === VIRTUAL_RUNTIME_ALT) {
        return RESOLVED_VIRTUAL_ID;
      }
      if (id.startsWith(THEME_PREFIX)) {
        const theme = id.slice(THEME_PREFIX.length);
        return fileURLToPath(
          import.meta.resolve(`@arborium/arborium/themes/${theme}`),
        );
      }
      // Resolve all imports originating from the virtual module to absolute
      // paths so consumers don't need any of these packages installed.
      if (importer === RESOLVED_VIRTUAL_ID) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return null;
    },

    // Only run the load hook on our virtual module (prevents rspack's
    // loader from intercepting unrelated files like HTML templates)
    loadInclude(id: string) {
      return id === RESOLVED_VIRTUAL_ID;
    },

    load(id: string) {
      if (id === RESOLVED_VIRTUAL_ID) {
        if (!generatedCode) {
          throw new Error(
            "unplugin-arborium: buildStart has not completed yet",
          );
        }
        return generatedCode;
      }
    },

    // Grammar JS modules (wasm-bindgen output) contain a dead-code fallback:
    //   new URL('arborium_<lang>_plugin_bg.wasm', import.meta.url)
    // We always pass the WASM explicitly so this is never reached, but
    // rspack/webpack statically analyze new URL() and error on the missing file.
    // Patch it out at transform time.
    transformInclude(id: string) {
      return (
        /[\\/]@arborium[\\/].*[\\/]grammar\.js$/.test(id) ||
        /[\\/]@arborium[\\/]arborium[\\/].*arborium_host\.js$/.test(id) ||
        /[\\/]@arborium[\\/]arborium[\\/]dist[\\/]arborium\.js$/.test(id)
      );
    },

    transform(code: string) {
      // Replace the dead-code new URL('...bg.wasm', import.meta.url)
      // with a no-op that will never execute (the if-guard checks
      // module_or_path === undefined, which is always false in our usage)
      let result = code.replace(
        /new URL\('[^']*_bg\.wasm',\s*import\.meta\.url\)/g,
        "undefined /* patched by unplugin-arborium */",
      );
      // Replace dynamic template-literal imports (CDN loading) with a stub.
      // These are annotated with /* @vite-ignore */ which suppresses Vite's
      // analysis but not rspack's — rspack would otherwise create a context
      // module matching all nearby files (including .map files) at build time.
      //
      // Note that, since we've completely replaced the arborium grammar
      // loading process, this code is dead anyway.
      result = result.replace(
        /import\s*\(\s*\/\* @vite-ignore \*\/\s*`[^`]*`\s*\)/g,
        "Promise.resolve({}) /* patched by unplugin-arborium */",
      );
      return result;
    },

    vite: {
      config() {
        return {
          optimizeDeps: {
            exclude: ["arborium"],
          },
        };
      },
    },

    // Webpack and rspack need an explicit rule to treat .wasm files
    // referenced via new URL() as static assets rather than JS modules.
    // Vite/Rollup handle this natively. esbuild needs a loader mapping.
    rspack(compiler: any) {
      compiler.options.module.rules.push({
        test: /\.wasm$/,
        type: "asset/resource",
      });
    },

    webpack(compiler: any) {
      compiler.options.module.rules.push({
        test: /\.wasm$/,
        type: "asset/resource",
      });
    },

    esbuild: {
      config(options: any) {
        options.loader = { ...options.loader, ".wasm": "file" };
      },
    },
  };
};

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory);
export default unplugin;

export { fromNodeModules, fromNpm } from "./core/resolvers.js";
export type {
  ArboriumPluginOptions,
  GrammarResolver,
  ResolveContext,
  ResolvedGrammars,
  ResolvedWasmModule,
} from "./types.js";
