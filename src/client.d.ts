declare module "arborium" {
  export {
    highlight,
    loadGrammar,
    detectLanguage,
    extractLanguageFromClass,
    normalizeLanguage,
    availableLanguages,
    pluginVersion,
  } from "@arborium/arborium";
  export function getAvailableLanguages(): string[];
  export function isLanguageAvailable(language: string): boolean;
}

declare module "arborium/runtime" {
  export {
    highlight,
    loadGrammar,
    detectLanguage,
    extractLanguageFromClass,
    normalizeLanguage,
    availableLanguages,
    pluginVersion,
  } from "@arborium/arborium";
  export function getAvailableLanguages(): string[];
  export function isLanguageAvailable(language: string): boolean;
}

declare module "arborium/themes/*.css" {}
