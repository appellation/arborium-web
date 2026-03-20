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
 */
export type GrammarResolver = (
  ctx: ResolveContext,
) => ResolvedGrammars | Promise<ResolvedGrammars>;

/** Plugin configuration options */
export interface ArboriumPluginOptions {
  /** Which languages to bundle. */
  languages: string[];
  /** How to resolve grammar WASM assets. Default: fromNodeModules() */
  resolve?: GrammarResolver;
}
