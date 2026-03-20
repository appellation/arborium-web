import { createUnplugin } from "unplugin";
import type { ArboriumPluginOptions } from "./types.js";
import { fromNodeModules, resolveHost } from "./core/resolvers.js";
import { generateRuntimeModule } from "./core/codegen.js";
import { checkLicenses } from "./core/licenses.js";

const VIRTUAL_RUNTIME_ID = "arborium";
const VIRTUAL_RUNTIME_ALT = "arborium/runtime";
const RESOLVED_VIRTUAL_ID = "\0arborium:runtime";

export const unpluginFactory = (options: ArboriumPluginOptions) => {
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

    resolveId(id: string) {
      if (id === VIRTUAL_RUNTIME_ID || id === VIRTUAL_RUNTIME_ALT) {
        return RESOLVED_VIRTUAL_ID;
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
        /[\\/]@arborium[\\/]arborium[\\/].*arborium_host\.js$/.test(id)
      );
    },

    transform(code: string) {
      // Replace the dead-code new URL('...bg.wasm', import.meta.url)
      // with a no-op that will never execute (the if-guard checks
      // module_or_path === undefined, which is always false in our usage)
      return code.replace(
        /new URL\('[^']*_bg\.wasm',\s*import\.meta\.url\)/g,
        "undefined /* patched by unplugin-arborium */",
      );
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
