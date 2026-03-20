import type {
  Grammar,
  RuntimeConfig,
  Session,
  Utf8ParseResult,
  Utf16ParseResult,
  WasmBindgenPlugin,
} from "./types.js";
import { escapeHtml } from "./utils.js";

// ============================================================================
// State
// ============================================================================

let config: RuntimeConfig | null = null;
let hostLoaded = false;
let hostLoadPromise: Promise<void> | null = null;

/** Internal cache of loaded grammar plugins */
interface LoadedGrammar {
  languageId: string;
  injectionLanguages: string[];
  module: WasmBindgenPlugin;
  parseUtf8: (text: string) => Utf8ParseResult;
  parseUtf16: (text: string) => Utf16ParseResult;
}

const grammarCache = new Map<string, LoadedGrammar>();
const grammarLoadPromises = new Map<string, Promise<LoadedGrammar | null>>();

// Handle-based bridge for the Rust host to reference grammars
const handleToGrammar = new Map<number, LoadedGrammar>();
let nextHandle = 1;

// ============================================================================
// Initialization (called by generated virtual module)
// ============================================================================

export function __initRuntime(cfg: RuntimeConfig): void {
  config = cfg;
}

// ============================================================================
// Host bridge (globalThis.arboriumHost)
// ============================================================================

function setupHostBridge(): void {
  (globalThis as any).arboriumHost = {
    isLanguageAvailable(language: string): boolean {
      return config?.grammars[language] != null || grammarCache.has(language);
    },

    async loadGrammar(language: string): Promise<number> {
      const grammar = await loadGrammarInternal(language);
      if (!grammar) return 0;

      // Check if we already assigned a handle
      for (const [handle, g] of handleToGrammar) {
        if (g === grammar) return handle;
      }

      const handle = nextHandle++;
      handleToGrammar.set(handle, grammar);
      return handle;
    },

    parse(handle: number, text: string): Utf8ParseResult {
      const grammar = handleToGrammar.get(handle);
      if (!grammar) return { spans: [], injections: [] };
      return grammar.parseUtf8(text);
    },
  };
}

// ============================================================================
// Host loading
// ============================================================================

async function ensureHost(): Promise<void> {
  if (hostLoaded) return;
  if (hostLoadPromise) return hostLoadPromise;
  if (!config) throw new Error("arborium: runtime not initialized");

  hostLoadPromise = (async () => {
    setupHostBridge();

    const { module, wasmUrl } = config!.host;
    const wasm = await fetch(wasmUrl);
    await module.default({ module_or_path: wasm });

    hostLoaded = true;
  })();

  return hostLoadPromise;
}

// ============================================================================
// Grammar loading
// ============================================================================

async function loadGrammarInternal(
  language: string,
): Promise<LoadedGrammar | null> {
  const cached = grammarCache.get(language);
  if (cached) return cached;

  const inFlight = grammarLoadPromises.get(language);
  if (inFlight) return inFlight;

  if (!config?.grammars[language]) return null;

  const promise = (async (): Promise<LoadedGrammar | null> => {
    const { module, wasmUrl } = config!.grammars[language];
    const wasm = await fetch(wasmUrl);
    await module.default({ module_or_path: wasm });

    const grammar: LoadedGrammar = {
      languageId: module.language_id(),
      injectionLanguages: module.injection_languages(),
      module,
      parseUtf8: (text) => {
        const session = module.create_session();
        try {
          module.set_text(session, text);
          const result = module.parse(session);
          return {
            spans: result.spans || [],
            injections: result.injections || [],
          };
        } finally {
          module.free_session(session);
        }
      },
      parseUtf16: (text) => {
        const session = module.create_session();
        try {
          module.set_text(session, text);
          const result = module.parse_utf16(session);
          return {
            spans: result.spans || [],
            injections: result.injections || [],
          };
        } finally {
          module.free_session(session);
        }
      },
    };

    grammarCache.set(language, grammar);
    return grammar;
  })();

  grammarLoadPromises.set(language, promise);
  try {
    return await promise;
  } finally {
    grammarLoadPromises.delete(language);
  }
}

// ============================================================================
// Public API
// ============================================================================

/** Highlight source code, returning an HTML string. */
export async function highlight(
  language: string,
  source: string,
): Promise<string> {
  await ensureHost();

  try {
    return await config!.host.module.highlight(language, source);
  } catch {
    return escapeHtml(source);
  }
}

/** Load a grammar for direct use (parsing, sessions). */
export async function loadGrammar(language: string): Promise<Grammar | null> {
  const loaded = await loadGrammarInternal(language);
  if (!loaded) return null;

  const { module } = loaded;

  return {
    languageId: () => loaded.languageId,
    injectionLanguages: () => loaded.injectionLanguages,
    highlight: (source: string) => highlight(language, source),
    parse: (source: string) => loaded.parseUtf16(source),
    createSession: (): Session => {
      const handle = module.create_session();
      return {
        setText: (text: string) => module.set_text(handle, text),
        parse: () => {
          const result = module.parse_utf16(handle);
          return {
            spans: result.spans || [],
            injections: result.injections || [],
          };
        },
        cancel: () => module.cancel(handle),
        free: () => module.free_session(handle),
      };
    },
    dispose: () => {},
  };
}

/** Get list of bundled languages. */
export function getAvailableLanguages(): string[] {
  if (!config) return [];
  return Object.keys(config.grammars);
}

/** Check if a language was bundled. */
export function isLanguageAvailable(language: string): boolean {
  if (!config) return false;
  return language in config.grammars;
}
