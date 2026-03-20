import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { pluginVersion, availableLanguages } from "@arborium/arborium";
import type { GrammarResolver, ResolvedWasmModule } from "../types.js";

const gunzipAsync = promisify(gunzip);

/**
 * Resolve the arborium host module from our own dependency.
 * Uses import.meta.resolve which resolves relative to this package,
 * where @arborium/arborium is a direct dependency.
 */
export function resolveHost(): ResolvedWasmModule {
  return {
    js: fileURLToPath(
      import.meta.resolve("@arborium/arborium/arborium_host.js"),
    ),
    wasm: fileURLToPath(
      import.meta.resolve("@arborium/arborium/arborium_host_bg.wasm"),
    ),
  };
}

export function resolveRuntimeCore(): string {
  return fileURLToPath(new URL("../runtime/index.js", import.meta.url));
}

export function resolveArborium(): string {
  return fileURLToPath(import.meta.resolve("@arborium/arborium"));
}

/**
 * Resolve grammar WASM assets from the consuming project's node_modules.
 *
 * Expects `@arborium/<lang>` packages to be installed
 * in the consuming project.
 */
export function fromNodeModules(): GrammarResolver {
  const resolver: GrammarResolver = (ctx) => {
    // Anchor resolution to the consumer's project directory
    const require = createRequire(resolve(process.cwd(), "package.json"));

    const grammars = new Map<string, ResolvedWasmModule>();
    for (const lang of ctx.languages) {
      const grammarJsPath = require.resolve(`@arborium/${lang}/grammar.js`);
      const grammarDir = dirname(grammarJsPath);
      grammars.set(lang, {
        js: grammarJsPath,
        wasm: resolve(grammarDir, "grammar_bg.wasm"),
      });
    }

    return { grammars };
  };

  resolver.discoverLanguages = async (): Promise<string[]> => {
    const arboriumDir = resolve(process.cwd(), "node_modules/@arborium");
    try {
      const dirents = await fsp.readdir(arboriumDir, { withFileTypes: true });
      return dirents
        .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && d.name !== "arborium")
        .map((d) => d.name);
    } catch {
      return [];
    }
  };

  return resolver;
}

/**
 * Resolve grammar WASM assets by fetching packages from the NPM registry at
 * build time. Packages are downloaded and cached in
 * `node_modules/.cache/unplugin-arborium/` — the consuming project does not
 * need to list `@arborium/<lang>` in its dependencies.
 */
export function fromNpm(options?: {
  registry?: string;
  cacheDir?: string;
}): GrammarResolver {
  const registry = options?.registry ?? "https://registry.npmjs.org";

  const resolver: GrammarResolver = async (ctx) => {
    const cacheDir =
      options?.cacheDir ??
      resolve(process.cwd(), "node_modules/.cache/unplugin-arborium");
    const grammars = new Map<string, ResolvedWasmModule>();

    await Promise.all(
      ctx.languages.map(async (lang) => {
        const resolved = await fetchGrammarPackage(
          `@arborium/${lang}`,
          pluginVersion,
          cacheDir,
          registry,
        );
        grammars.set(lang, resolved);
      }),
    );

    return { grammars };
  };

  resolver.discoverLanguages = (): string[] => availableLanguages;

  return resolver;
}

async function fetchGrammarPackage(
  pkg: string,
  version: string,
  cacheDir: string,
  registry: string,
): Promise<ResolvedWasmModule> {
  // Cache at: node_modules/.cache/unplugin-arborium/@arborium/json/<version>/
  // path.resolve treats "@arborium/json" as a relative path → creates the
  // nested directory structure, which also satisfies the transformInclude regex.
  const pkgCacheDir = resolve(cacheDir, pkg);
  const versionDir = resolve(pkgCacheDir, version);
  const jsPath = resolve(versionDir, "grammar.js");
  const wasmPath = resolve(versionDir, "grammar_bg.wasm");

  // If this exact version is already cached, use it.
  const cached = await fsp
    .access(jsPath)
    .then(() => fsp.access(wasmPath))
    .then(() => true, () => false);
  if (cached) {
    return { js: jsPath, wasm: wasmPath };
  }

  // No cache hit — fetch the tarball for the pinned version from the registry.
  // Encode scoped package name: "@arborium/json" → "%40arborium%2Fjson"
  const encodedPkg = pkg.replace(/^@/, "%40").replace("/", "%2F");

  const metaRes = await fetch(`${registry}/${encodedPkg}/${version}`);
  if (!metaRes.ok) {
    throw new Error(
      `unplugin-arborium: failed to fetch metadata for ${pkg}@${version} from ${registry} (${metaRes.status} ${metaRes.statusText})`,
    );
  }

  const meta = (await metaRes.json()) as {
    version: string;
    dist: { tarball: string };
  };
  const { dist } = meta;

  const tarRes = await fetch(dist.tarball);
  if (!tarRes.ok) {
    throw new Error(
      `unplugin-arborium: failed to download tarball for ${pkg}@${version}`,
    );
  }

  const compressed = Buffer.from(await tarRes.arrayBuffer());
  const decompressed = await gunzipAsync(compressed);
  const files = extractTarEntries(decompressed, new Set(["grammar.js", "grammar_bg.wasm"]));

  const jsContent = files.get("grammar.js");
  const wasmContent = files.get("grammar_bg.wasm");
  if (!jsContent || !wasmContent) {
    throw new Error(
      `unplugin-arborium: could not find grammar.js or grammar_bg.wasm in ${pkg}@${version}`,
    );
  }

  await fsp.mkdir(versionDir, { recursive: true });
  await fsp.writeFile(jsPath, jsContent);
  await fsp.writeFile(wasmPath, wasmContent);

  return { js: jsPath, wasm: wasmPath };
}

/**
 * Extract named files from an uncompressed tar buffer.
 * Matches by basename, returning file contents keyed by name.
 */
function extractTarEntries(
  buffer: Buffer,
  names: Set<string>,
): Map<string, Buffer> {
  const results = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*/, "");
    const sizeStr = header
      .subarray(124, 136)
      .toString("utf8")
      .replace(/\0.*/, "")
      .trim();
    const size = parseInt(sizeStr, 8) || 0;

    offset += 512;

    if (size > 0) {
      const basename = name.split("/").pop()!;
      if (names.has(basename)) {
        results.set(basename, Buffer.from(buffer.subarray(offset, offset + size)));
        if (results.size === names.size) break;
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }

  return results;
}
