declare module "arborium" {
  export {
    highlight,
    loadGrammar,
    getAvailableLanguages,
    isLanguageAvailable,
  } from "unplugin-arborium/runtime-core";
  export {
    detectLanguage,
    extractLanguageFromClass,
    normalizeLanguage,
    availableLanguages,
    pluginVersion,
  } from "@arborium/arborium";
}

declare module "arborium/runtime" {
  export {
    highlight,
    loadGrammar,
    getAvailableLanguages,
    isLanguageAvailable,
  } from "unplugin-arborium/runtime-core";
}

declare module "arborium/themes/*.css" {}
