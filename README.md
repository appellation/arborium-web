# unplugin-arborium

A build-time plugin for integrating [Arborium](https://arborium.dev) syntax highlighting into web applications. Resolves grammar packages and WebAssembly assets at build time, generates a virtual runtime module, and emits WASM files as hashed static assets your bundler can cache and serve efficiently.

Supports Vite, Webpack, Rollup, Rspack, esbuild, and Next.js via [unplugin](https://github.com/unjs/unplugin).

## Installation

```sh
npm install unplugin-arborium @arborium/arborium
```

Grammar packages are optional — see [Grammar Resolvers](#grammar-resolvers) for details. If you use the default resolver, install `@arborium/<language>` packages for each language you want to bundle:

```sh
npm install @arborium/json @arborium/rust
```

## Usage

### Vite

```ts
// vite.config.ts
import arborium from "unplugin-arborium/vite";

export default {
  plugins: [
    arborium(),
  ],
};
```

### Webpack

```js
// webpack.config.js
const arborium = require("unplugin-arborium/webpack");

module.exports = {
  plugins: [
    arborium(),
  ],
};
```

### Rollup

```js
// rollup.config.js
import arborium from "unplugin-arborium/rollup";

export default {
  plugins: [
    arborium(),
  ],
};
```

### esbuild

```js
import arborium from "unplugin-arborium/esbuild";
import { build } from "esbuild";

build({
  plugins: [
    arborium(),
  ],
});
```

### Next.js

```js
// next.config.js
const arborium = require("unplugin-arborium/next");

module.exports = {
  webpack(config) {
    config.plugins.push(
      arborium()
    );
    return config;
  },
};
```

## Runtime API

Once the plugin is configured, import from the virtual `"arborium"` module in your application code:

```ts
import { highlight, loadGrammar, getAvailableLanguages, isLanguageAvailable } from "arborium";

// Highlight source code, returns an HTML string
const html = await highlight("json", '{"hello": "world"}');

// Load a grammar directly for advanced use
const grammar = await loadGrammar("rust");

// Inspect bundled languages
const langs = getAvailableLanguages(); // ["json", "rust"]
const hasRust = isLanguageAvailable("rust"); // true
```

Add the client type declarations to your `tsconfig.json` so TypeScript recognizes the virtual module:

```json
{
  "compilerOptions": {
    "types": ["unplugin-arborium/client"]
  }
}
```

## Plugin Options

| Option | Type | Default | Description |
|---|---|---|---|
| `resolve` | `GrammarResolver` | `fromNodeModules()` | Resolver for grammar packages. `discoverLanguages` determines which languages to bundle. |
| `allowedLicenses` | `string[]` | `undefined` | SPDX license identifiers permitted for bundled grammars. The license is resolved from the underlying tree-sitter grammar's `arborium.yaml` in the [bearcove/arborium](https://github.com/bearcove/arborium) repository. If any language's license is not in this set, the build fails. `undefined` (the default) allows all licenses; an empty array disallows all licenses. |

## Grammar Resolvers

The resolver determines how grammar WASM assets are located at build time. Each built-in resolver also provides a default language list when `languages` is omitted.

### `fromNodeModules()` (default)

Resolves grammars from your project's `node_modules`. Install the grammar packages you want:

```sh
npm install @arborium/json @arborium/rust
```

The plugin scans `node_modules/@arborium/` at build time and bundles every installed grammar package automatically.

### `fromNpm()`

Fetches grammar packages directly from the NPM registry at build time, with no installation step required. Packages are downloaded once and cached in `node_modules/.cache/unplugin-arborium/`, so subsequent builds are fast even without the packages in `node_modules`.

All available languages are bundled by default. This is useful when you want to keep grammars out of your `package.json` dependencies or support every language without managing installs.

```ts
import arborium from "unplugin-arborium/vite";
import { fromNpm } from "unplugin-arborium/resolvers";

export default {
  plugins: [
    arborium({ resolve: fromNpm() }),
  ],
};
```

`fromNpm` accepts options:

```ts
fromNpm({
  registry: "https://registry.npmjs.org", // Custom registry URL
  cacheDir: ".cache/arborium",            // Custom cache directory
})
```

### Writing a custom resolver

A resolver is a function that receives a `ResolveContext` and returns absolute file paths for each grammar's JS glue file and WASM binary:

```ts
import type { GrammarResolver } from "unplugin-arborium/types";

const myResolver: GrammarResolver = (ctx) => {
  const grammars = new Map();

  for (const lang of ctx.languages) {
    grammars.set(lang, {
      js:   `/path/to/grammars/${lang}/grammar.js`,
      wasm: `/path/to/grammars/${lang}/grammar_bg.wasm`,
    });
  }

  return { grammars };
};
```

Custom resolvers must implement `discoverLanguages` so the plugin knows which languages to bundle:

```ts
myResolver.discoverLanguages = () => ["json", "rust"];

arborium({ resolve: myResolver })
```

**Types:**

```ts
// Context passed to your resolver
interface ResolveContext {
  languages: string[]; // the languages array from plugin options
}

// Paths for one grammar package (wasm-bindgen output)
interface ResolvedWasmModule {
  js:   string; // absolute path to the JS glue file
  wasm: string; // absolute path to the .wasm binary
}

// What your resolver must return
interface ResolvedGrammars {
  grammars: Map<string, ResolvedWasmModule>;
}

type GrammarResolver = {
  (ctx: ResolveContext): ResolvedGrammars | Promise<ResolvedGrammars>;
  discoverLanguages(): string[] | Promise<string[]>;
};
```

Resolvers can be async, so you can fetch, extract, or generate files before returning. All paths must be absolute. The host WASM module (`@arborium/arborium`) is always resolved from the plugin's own dependencies and does not need to be handled by the resolver.

## How It Works

1. **Build time** — The plugin's `buildStart` hook resolves each requested grammar package and the Arborium host WASM from `node_modules` (or NPM). It generates a virtual module that imports all resolved WASM assets using `new URL(..., import.meta.url)`, causing the bundler to emit them as hashed static files.

2. **Runtime** — The virtual module initializes the Arborium host and registers all bundled grammars. WASM modules are loaded lazily on first use. Parse results use UTF-16 offsets, which are native to JavaScript strings.

3. **Bundler integration** — Each supported bundler receives tool-specific WASM asset configuration (Vite uses native WASM support, Webpack/Rspack add asset/resource rules, esbuild uses file loader). Grammar JS modules are bundled normally, with dead-code WASM URL references patched out.

## License

MIT OR Apache-2.0
