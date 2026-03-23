# unplugin-arborium

A build-time plugin for integrating [Arborium](https://arborium.bearcove.eu/) syntax highlighting into web applications. Resolves grammar packages and WebAssembly assets at build time, generates a virtual runtime module, and emits WASM files as hashed static assets your bundler can cache and serve efficiently.

Supports Vite, Rollup, webpack, esbuild, Rspack, Rolldown, Farm, Bun, and Next.js via [unplugin](https://github.com/unjs/unplugin).

## Installation

1. Visit the [latest release](https://github.com/appellation/arborium-web/releases/latest)
2. Copy the URL to the tarball
3. Run `npm i -D [url]`

Grammar packages are optional — see [Grammar Resolvers](#grammar-resolvers) for details. If you use the default resolver, install `@arborium/<language>` packages for each language you want to bundle:

```sh
npm install -D @arborium/json @arborium/rust
```

## Usage

<details>
<summary>Vite</summary>

```ts
// vite.config.ts
import arborium from "unplugin-arborium/vite";

export default {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>Rollup</summary>

```js
// rollup.config.js
import arborium from "unplugin-arborium/rollup";

export default {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>webpack</summary>

```js
// webpack.config.js
const arborium = require("unplugin-arborium/webpack");

module.exports = {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>esbuild</summary>

```js
import arborium from "unplugin-arborium/esbuild";
import { build } from "esbuild";

build({
  plugins: [
    arborium(),
  ],
});
```

</details>

<details>
<summary>Rspack</summary>

```js
// rspack.config.js
const arborium = require("unplugin-arborium/rspack");

module.exports = {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>Rolldown</summary>

```js
// rolldown.config.js
import arborium from "unplugin-arborium/rolldown";

export default {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>Farm</summary>

```ts
// farm.config.ts
import arborium from "unplugin-arborium/farm";

export default {
  plugins: [
    arborium(),
  ],
};
```

</details>

<details>
<summary>Bun</summary>

Bun's build API accepts esbuild-compatible plugins:

```ts
import arborium from "unplugin-arborium/esbuild";

await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  plugins: [
    arborium(),
  ],
});
```

</details>

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
| `resolve` | `GrammarResolver` | `fromNodeModules()` | Resolver for grammar packages. `discoverLanguages` determines which languages to bundle when `languages` is not set. |
| `languages` | `string[]` | `undefined` | Explicit list of languages to bundle. Overrides the resolver's `discoverLanguages` when provided. |
| `allowedLicenses` | `string[]` | `undefined` | SPDX license identifiers permitted for bundled grammars. If any grammar's license is not in this set, the build fails. `undefined` (the default) allows all licenses. |

### Licenses

`allowedLicenses` is designed to be noisy so that you don't accidentally drop language support if an included grammar updates its license to something unexpected. Currently, the only GPL-licensed grammar is `nginx`, which you can exclude via the `languages` option:

```js
import arborium from "unplugin-arborium/webpack"; // or your bundler of choice
import { availableLanguages, fromNpm } from "unplugin-arborium";

arborium({
  languages: availableLanguages.filter(lang => lang !== "nginx"),
  allowedLicenses: ["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause"],
})
```

## Grammar Resolvers

The resolver determines how grammar WASM assets are located at build time. Each built-in resolver also provides a default language list when `languages` is omitted.

### `fromNodeModules()` (default)

Resolves grammars from your project's `node_modules`. Install the grammar packages you want:

```sh
npm install @arborium/json @arborium/rust
```

The plugin scans `node_modules/@arborium/` at build time and bundles every installed grammar package automatically.

#### Transitive grammar packages

If grammars are installed by a dependency rather than your project directly (e.g. a plugin that ships its own grammar set as a barrel package), use the `transitivePackages` option. Each entry is either a package name (one hop from the root) or an ordered array of package names forming an explicit chain to follow:

```ts
import { fromNodeModules } from "unplugin-arborium/resolvers";

arborium({
  resolve: fromNodeModules({
    transitivePackages: [
      // grammars installed directly by a dependency
      "@my-org/plugin",

      // grammars installed by a package that is itself a dep of a plugin
      ["@my-org/plugin", "@my-org/grammars"],
    ],
  }),
})
```

Each chain is resolved in sequence: `@my-org/grammars` is looked up from `@my-org/plugin`'s node_modules context, not the root. This works correctly with pnpm's strict node_modules layout.

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
