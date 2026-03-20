/**
 * Simple language detection heuristics.
 * Not meant to be comprehensive - just catches common cases.
 */

const SHEBANG_PATTERNS: Array<[RegExp, string]> = [
  [/^#!.*\bpython[23]?\b/, "python"],
  [/^#!.*\bnode\b/, "javascript"],
  [/^#!.*\bdeno\b/, "typescript"],
  [/^#!.*\bbun\b/, "typescript"],
  [/^#!.*\bruby\b/, "ruby"],
  [/^#!.*\bperl\b/, "perl"],
  [/^#!.*\bphp\b/, "php"],
  [/^#!.*\bbash\b/, "bash"],
  [/^#!.*\bzsh\b/, "zsh"],
  [/^#!.*\bsh\b/, "bash"],
  [/^#!.*\blua\b/, "lua"],
  [/^#!.*\bawk\b/, "awk"],
];

const KEYWORD_FINGERPRINTS: Array<[RegExp, string]> = [
  [/\b(fn|impl|trait|pub\s+fn|let\s+mut|&mut|->)\b/, "rust"],
  [/\b(func|package\s+\w+|import\s+\(|go\s+func|chan\s+\w+)\b/, "go"],
  [
    /\b(def\s+\w+\s*\(|import\s+\w+|from\s+\w+\s+import|class\s+\w+:)\b/,
    "python",
  ],
  [/:\s*(string|number|boolean|void)\b|\binterface\s+\w+\s*\{/, "typescript"],
  [/\b(const|let|var)\s+\w+\s*=|function\s+\w+\s*\(|=>\s*\{/, "javascript"],
  [/\b(def\s+\w+|end\b|do\s*\|.*\||puts\s+|require\s+['"])\b/, "ruby"],
  [/\b(public\s+class|private\s+\w+|System\.out\.println)\b/, "java"],
  [/\b(#include\s*<|std::|template\s*<|nullptr|cout\s*<<)\b/, "cpp"],
  [/\b(#include\s*[<"]|printf\s*\(|int\s+main\s*\(|void\s+\w+\s*\()\b/, "c"],
  [/\b(namespace\s+\w+|using\s+System|public\s+static\s+void)\b/, "c-sharp"],
  [/<\?php|\$\w+\s*=/, "php"],
  [/\b(func\s+\w+|var\s+\w+:\s*\w+|let\s+\w+:\s*\w+|@objc)\b/, "swift"],
  [/\b(fun\s+\w+|val\s+\w+|var\s+\w+:|data\s+class)\b/, "kotlin"],
  [/\b(def\s+\w+|val\s+\w+|var\s+\w+|object\s+\w+|case\s+class)\b/, "scala"],
  [
    /\b(module\s+\w+|import\s+qualified|data\s+\w+\s*=|::\s*\w+\s*->)\b/,
    "haskell",
  ],
  [/\b(defmodule\s+\w+|def\s+\w+|defp\s+\w+|\|>)\b/, "elixir"],
  [/\b(local\s+\w+\s*=|function\s+\w+\.\w+|require\s*\()\b/, "lua"],
  [
    /\b(SELECT\s+.*\s+FROM|INSERT\s+INTO|CREATE\s+TABLE|ALTER\s+TABLE)\b/i,
    "sql",
  ],
  [/\b(if\s+\[\s*|then\b|fi\b|echo\s+["']|export\s+\w+=)\b/, "bash"],
  [/^\s*[\w-]+:\s*[\w\-"'[{]|^---\s*$/, "yaml"],
  [/^\s*\{[\s\S]*"[\w-]+":\s*/, "json"],
  [/^\s*\[[\w.-]+\]\s*$|^\s*\w+\s*=\s*["'\d\[]/, "toml"],
  [/<(!DOCTYPE|html|head|body|div|span|p|a\s)/i, "html"],
  [/^\s*[\w.#@][\w\s,#.:>+~-]*\{[^}]*\}|@media\s|@import\s/, "css"],
  [/^#{1,6}\s+\w|^\s*[-*+]\s+\w|^\s*\d+\.\s+\w|```\w*\n/, "markdown"],
  [/<\?xml|<[\w:-]+\s+xmlns/, "xml"],
  [/^FROM\s+\w+|^RUN\s+|^COPY\s+|^ENTRYPOINT\s+/m, "dockerfile"],
  [/\b(server\s*\{|location\s+[\/~]|proxy_pass\s+)\b/, "nginx"],
  [/\b(pub\s+fn|const\s+\w+\s*=|@import\(|comptime)\b/, "zig"],
];

/** Detect the language of a code snippet. Returns null if detection fails. */
export function detectLanguage(source: string): string | null {
  const firstLine = source.split("\n")[0];
  for (const [pattern, language] of SHEBANG_PATTERNS) {
    if (pattern.test(firstLine)) return language;
  }
  for (const [pattern, language] of KEYWORD_FINGERPRINTS) {
    if (pattern.test(source)) return language;
  }
  return null;
}

/** Extract language from a CSS class name. */
export function extractLanguageFromClass(className: string): string | null {
  const langMatch = className.match(/\blanguage-(\w+)\b/);
  if (langMatch) return langMatch[1];

  const shortMatch = className.match(/\blang-(\w+)\b/);
  if (shortMatch) return shortMatch[1];

  const knownLanguages = new Set([
    "rust",
    "javascript",
    "typescript",
    "python",
    "ruby",
    "go",
    "java",
    "c",
    "cpp",
    "csharp",
    "php",
    "swift",
    "kotlin",
    "scala",
    "haskell",
    "elixir",
    "lua",
    "sql",
    "bash",
    "shell",
    "yaml",
    "json",
    "toml",
    "html",
    "css",
    "xml",
    "markdown",
    "dockerfile",
    "nginx",
    "zig",
    "text",
    "plaintext",
    "console",
    "sh",
  ]);

  for (const cls of className.split(/\s+/)) {
    if (knownLanguages.has(cls.toLowerCase())) return cls.toLowerCase();
  }
  return null;
}

/** Normalize language identifier (handle aliases). */
export function normalizeLanguage(lang: string): string {
  const aliases: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    yml: "yaml",
    cs: "c-sharp",
    csharp: "c-sharp",
    "c++": "cpp",
    "c#": "c-sharp",
    "f#": "fsharp",
    dockerfile: "dockerfile",
    docker: "dockerfile",
    makefile: "make",
    plaintext: "text",
    plain: "text",
    txt: "text",
  };

  const lower = lang.toLowerCase();
  return aliases[lower] || lower;
}
