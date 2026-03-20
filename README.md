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
const langs = getAvailableLanguages(); // ["ada", "agda", "awk", ...]
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
| `languages` | `string[]` | all available | Language identifiers to bundle. Defaults to all languages published under the `@arborium` scope. When using the default resolver, each must have a corresponding `@arborium/<language>` package installed. When using `fromNpm()`, no prior installation is needed. |
| `resolve` | `GrammarResolver` | `fromNodeModules()` | Custom resolver for grammar packages |

## Grammar Resolvers

Grammar packages do not need to be installed as project dependencies. The resolver you choose determines how packages are located at build time.

### `fromNodeModules()` (default)

Resolves grammars from your project's `node_modules`. You must install each grammar package explicitly:

```sh
npm install @arborium/json @arborium/rust
```

This is the default — no resolver configuration is required.

### `fromNpm()`

Fetches grammar packages directly from the NPM registry at build time, with no installation step required. Packages are downloaded once and cached in `node_modules/.cache/unplugin-arborium/`, so subsequent builds are fast even without the packages in `node_modules`.

This is useful when you want to keep grammars out of your `package.json` dependencies, use many languages without cluttering your lockfile, or dynamically configure which languages to bundle (e.g. from an environment variable or config file) without managing installs separately.

```ts
import arborium from "unplugin-arborium/vite";
import { fromNpm } from "unplugin-arborium/resolvers";

export default {
  plugins: [
    arborium({
      resolve: fromNpm(),
    }),
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

Then pass it to the plugin:

```ts
arborium({
  resolve: myResolver,
})
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

type GrammarResolver = (ctx: ResolveContext) => ResolvedGrammars | Promise<ResolvedGrammars>;
```

Resolvers can be async, so you can fetch, extract, or generate files before returning. All paths must be absolute. The host WASM module (`@arborium/arborium`) is always resolved from the plugin's own dependencies and does not need to be handled by the resolver.

## How It Works

1. **Build time** — The plugin's `buildStart` hook resolves each requested grammar package and the Arborium host WASM from `node_modules` (or NPM). It generates a virtual module that imports all resolved WASM assets using `new URL(..., import.meta.url)`, causing the bundler to emit them as hashed static files.

2. **Runtime** — The virtual module initializes the Arborium host and registers all bundled grammars. WASM modules are loaded lazily on first use. Parse results use UTF-16 offsets, which are native to JavaScript strings.

3. **Bundler integration** — Each supported bundler receives tool-specific WASM asset configuration (Vite uses native WASM support, Webpack/Rspack add asset/resource rules, esbuild uses file loader). Grammar JS modules are bundled normally, with dead-code WASM URL references patched out.

## License

MIT OR Apache-2.0
