import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GrammarResolver, ResolvedWasmModule } from "../types.js";

/**
 * Resolve the arborium host module from our own dependency.
 * Uses import.meta.resolve which resolves relative to this package,
 * where @arborium/arborium is a direct dependency.
 */
export function resolveHost(): ResolvedWasmModule {
  return {
    js: fileURLToPath(
      import.meta.resolve("@arborium/arborium/arborium_host.js"),
    ),
    wasm: fileURLToPath(
      import.meta.resolve("@arborium/arborium/arborium_host_bg.wasm"),
    ),
  };
}

/**
 * Resolve grammar WASM assets from the consuming project's node_modules.
 *
 * Expects `@arborium/<lang>` packages to be installed
 * in the consuming project.
 */
export function fromNodeModules(): GrammarResolver {
  return (ctx) => {
    // Anchor resolution to the consumer's project directory
    const require = createRequire(resolve(process.cwd(), "package.json"));

    const grammars = new Map<string, ResolvedWasmModule>();
    for (const lang of ctx.languages) {
      const grammarJsPath = require.resolve(`@arborium/${lang}/grammar.js`);
      const grammarDir = dirname(grammarJsPath);
      grammars.set(lang, {
        js: grammarJsPath,
        wasm: resolve(grammarDir, "grammar_bg.wasm"),
      });
    }

    return { grammars };
  };
}
