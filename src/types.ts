/** Resolved asset paths for a single WASM module (JS glue + WASM binary) */
export interface ResolvedWasmModule {
  /** Absolute path to the JS glue file (wasm-bindgen output) */
  js: string;
  /** Absolute path to the .wasm binary */
  wasm: string;
}

/** Context passed to the grammar resolver callback */
export interface ResolveContext {
  /** The languages the user requested */
  languages: string[];
}

/** Result of resolving grammar WASM assets at build time */
export interface ResolvedGrammars {
  /** Per-language grammar modules */
  grammars: Map<string, ResolvedWasmModule>;
}

/**
 * Callback that resolves WASM assets for each grammar.
 * Called once at build time. Must return absolute file paths.
 * The host module is resolved automatically from @arborium/arborium.
 *
 * Built-in resolvers (fromNodeModules, fromNpm) attach a `discoverLanguages`
 * method that the plugin calls when `languages` is omitted from plugin options.
 * Custom resolver functions may optionally attach this method too; without it,
 * an explicit `languages` array is required.
 */
export type GrammarResolver = {
  (ctx: ResolveContext): ResolvedGrammars | Promise<ResolvedGrammars>;
  discoverLanguages(): string[] | Promise<string[]>;
};

/** Plugin configuration options */
export interface ArboriumPluginOptions {
  /** How to resolve grammar WASM assets. Default: fromNodeModules() */
  resolve?: GrammarResolver;
  /**
   * Explicit list of languages to bundle. Overrides the resolver's
   * `discoverLanguages` when provided.
   */
  languages?: string[];
  /**
   * SPDX license identifiers that grammar packages are permitted to use.
   * The license is read from the underlying tree-sitter grammar's arborium.yaml
   * in the bearcove/arborium repository. If a language's license is not in this
   * set, the build fails. An empty array (the default) allows all licenses.
   */
  allowedLicenses?: string[];
}
