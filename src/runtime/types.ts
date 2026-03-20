// ============================================================================
// UTF-8 types (internal, for Rust host)
// ============================================================================

/**
 * A span of highlighted text with UTF-8 byte offsets.
 * This is the native format from tree-sitter.
 * @internal
 */
export interface Utf8Span {
  /** UTF-8 byte offset where the span starts (inclusive) */
  start: number;
  /** UTF-8 byte offset where the span ends (exclusive) */
  end: number;
  /** The capture name (e.g., "keyword", "string", "comment") */
  capture: string;
}

/**
 * A language injection with UTF-8 byte offsets.
 * @internal
 */
export interface Utf8Injection {
  start: number;
  end: number;
  language: string;
  includeChildren: boolean;
}

/**
 * Result of parsing source code, with UTF-8 byte offsets.
 * @internal
 */
export interface Utf8ParseResult {
  spans: Utf8Span[];
  injections: Utf8Injection[];
}

// ============================================================================
// UTF-16 types (public API, for JavaScript)
// ============================================================================

/** A span of highlighted text with UTF-16 code unit indices. */
export interface Utf16Span {
  /** UTF-16 code unit index where the span starts (inclusive) */
  start: number;
  /** UTF-16 code unit index where the span ends (exclusive) */
  end: number;
  /** The capture name (e.g., "keyword", "string", "comment") */
  capture: string;
}

/** A language injection with UTF-16 code unit indices. */
export interface Utf16Injection {
  start: number;
  end: number;
  language: string;
  includeChildren: boolean;
}

/** Result of parsing source code, with UTF-16 code unit indices. */
export interface Utf16ParseResult {
  spans: Utf16Span[];
  injections: Utf16Injection[];
}

// ============================================================================
// Legacy type aliases
// ============================================================================

/** @deprecated Use {@link Utf16Span} */
export type Span = Utf16Span;
/** @deprecated Use {@link Utf16Injection} */
export type Injection = Utf16Injection;
/** @deprecated Use {@link Utf16ParseResult} */
export type ParseResult = Utf16ParseResult;

// ============================================================================
// Session and Grammar interfaces
// ============================================================================

/** A parsing session for incremental highlighting. */
export interface Session {
  setText(text: string): void;
  parse(): Utf16ParseResult;
  cancel(): void;
  /** Free session resources. Must be called when done. */
  free(): void;
}

/** A loaded grammar plugin. */
export interface Grammar {
  languageId(): string;
  injectionLanguages(): string[];
  highlight(source: string): string | Promise<string>;
  parse(source: string): Utf16ParseResult;
  createSession(): Session;
  dispose(): void;
}

// ============================================================================
// Internal wasm-bindgen interfaces
// ============================================================================

type MaybePromise<T> = T | Promise<T>;
type WbgInitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

/** wasm-bindgen grammar plugin module interface */
export interface WasmBindgenPlugin {
  default: (
    module_or_path?: { module_or_path: MaybePromise<WbgInitInput> } | undefined,
  ) => Promise<void>;
  language_id: () => string;
  injection_languages: () => string[];
  create_session: () => number;
  free_session: (session: number) => void;
  set_text: (session: number, text: string) => void;
  parse: (session: number) => Utf8ParseResult;
  parse_utf16: (session: number) => Utf16ParseResult;
  cancel: (session: number) => void;
}

/** wasm-bindgen host module interface */
export interface WasmBindgenHost {
  default: (
    module_or_path?: { module_or_path: MaybePromise<WbgInitInput> } | undefined,
  ) => Promise<void>;
  highlight(language: string, source: string): Promise<string>;
  isLanguageAvailable(language: string): boolean;
}

/** Runtime configuration passed from the generated virtual module */
export interface RuntimeConfig {
  host: {
    module: WasmBindgenHost;
    wasmUrl: URL;
  };
  grammars: Record<
    string,
    {
      module: WasmBindgenPlugin;
      wasmUrl: URL;
    }
  >;
}
