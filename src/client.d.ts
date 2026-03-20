declare module "arborium" {
  export {
    highlight,
    loadGrammar,
    getAvailableLanguages,
    isLanguageAvailable,
  } from "unplugin-arborium/runtime-core";
  export type {
    Grammar,
    Session,
    Span,
    Injection,
    ParseResult,
    Utf16Span,
    Utf16Injection,
    Utf16ParseResult,
  } from "unplugin-arborium/types";
}

declare module "arborium/runtime" {
  export {
    highlight,
    loadGrammar,
    getAvailableLanguages,
    isLanguageAvailable,
  } from "unplugin-arborium/runtime-core";
  export type {
    Grammar,
    Session,
    Span,
    Injection,
    ParseResult,
    Utf16Span,
    Utf16Injection,
    Utf16ParseResult,
  } from "unplugin-arborium/types";
}
