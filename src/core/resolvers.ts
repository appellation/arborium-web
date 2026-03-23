import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import { pluginVersion, availableLanguages } from "@arborium/arborium";
import type { GrammarResolver, ResolvedWasmModule } from "../types.js";


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


/**
 * Resolve grammar WASM assets from the consuming project's node_modules.
 *
 * Expects `@arborium/<lang>` packages to be installed in the consuming project
 * or, when `transitivePackages` is specified, within those packages' own
 * node_modules (e.g. a plugin that ships its own grammars as dependencies).
 */
export function fromNodeModules(options?: {
  /**
   * Packages to search for `@arborium/<lang>` grammars beyond the root
   * project. Each entry is either a package name (one hop from the root) or
   * an ordered chain of package names to follow in sequence — useful when
   * grammars are installed several layers deep in a known dependency path.
   *
   * @example
   * // grammars installed directly by a dependency
   * transitivePackages: ["@my-org/plugin"]
   *
   * // grammars installed by a package that is itself a dependency of a plugin
   * transitivePackages: [["@my-org/plugin", "@my-org/grammars"]]
   */
  transitivePackages?: Array<string | string[]>;
}): GrammarResolver {
  const rootRequire = createRequire(resolve(process.cwd(), "package.json"));

  function tryResolveGrammar(req: ReturnType<typeof createRequire>, lang: string): ResolvedWasmModule | null {
    try {
      const grammarJsPath = req.resolve(`@arborium/${lang}/grammar.js`);
      return { js: grammarJsPath, wasm: resolve(dirname(grammarJsPath), "grammar_bg.wasm") };
    } catch {
      return null;
    }
  }

  /**
   * Follow a chain of package names, each resolved from the previous
   * package's context. Returns the require context and package.json path
   * of the final package, or null if any step fails to resolve.
   */
  function resolveChain(chain: string[]): { req: ReturnType<typeof createRequire>; pkgJsonPath: string } | null {
    let req = rootRequire;
    let pkgJsonPath: string;
    for (const pkg of chain) {
      try {
        pkgJsonPath = req.resolve(`${pkg}/package.json`);
        req = createRequire(pkgJsonPath!);
      } catch {
        return null;
      }
    }
    return pkgJsonPath! ? { req, pkgJsonPath: pkgJsonPath! } : null;
  }

  function buildRequireContexts(): ReturnType<typeof createRequire>[] {
    const contexts: ReturnType<typeof createRequire>[] = [rootRequire];
    for (const entry of options?.transitivePackages ?? []) {
      const chain = Array.isArray(entry) ? entry : [entry];
      const resolved = resolveChain(chain);
      if (resolved) contexts.push(resolved.req);
    }
    return contexts;
  }

  const resolver: GrammarResolver = (ctx) => {
    const contexts = buildRequireContexts();
    const grammars = new Map<string, ResolvedWasmModule>();

    for (const lang of ctx.languages) {
      for (const req of contexts) {
        const resolved = tryResolveGrammar(req, lang);
        if (resolved) {
          grammars.set(lang, resolved);
          break;
        }
      }
      if (!grammars.has(lang)) {
        throw new Error(
          `unplugin-arborium: grammar package @arborium/${lang} could not be resolved`,
        );
      }
    }

    return { grammars };
  };

  resolver.discoverLanguages = async (): Promise<string[]> => {
    const discovered = new Set<string>();

    async function scanArboriumDir(dir: string): Promise<void> {
      try {
        const dirents = await fsp.readdir(dir, { withFileTypes: true });
        for (const d of dirents) {
          if ((d.isDirectory() || d.isSymbolicLink()) && d.name !== "arborium") {
            discovered.add(d.name);
          }
        }
      } catch {
        // directory doesn't exist — skip
      }
    }

    await scanArboriumDir(resolve(process.cwd(), "node_modules/@arborium"));

    for (const entry of options?.transitivePackages ?? []) {
      const chain = Array.isArray(entry) ? entry : [entry];
      const resolved = resolveChain(chain);
      if (!resolved) continue;

      try {
        const pkgJson = JSON.parse(await fsp.readFile(resolved.pkgJsonPath, "utf8")) as {
          dependencies?: Record<string, string>;
        };
        for (const dep of Object.keys(pkgJson.dependencies ?? {})) {
          if (dep.startsWith("@arborium/") && dep !== "@arborium/arborium") {
            const lang = dep.slice("@arborium/".length);
            try {
              resolved.req.resolve(`${dep}/grammar.js`);
              discovered.add(lang);
            } catch {
              // dep listed but not resolvable — skip
            }
          }
        }
      } catch {
        // package.json unreadable — skip silently
      }
    }

    return [...discovered];
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

  const files = await extractTarEntries(tarRes.body!, ["grammar.js", "grammar_bg.wasm"]);

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

async function extractTarEntries(
  source: ReadableStream<Uint8Array>,
  names: string[],
): Promise<Map<string, Buffer>> {
  const wanted = new Set(names);
  const results = new Map<string, Buffer>();
  const ex = extract();

  ex.on("entry", (header, stream, callback) => {
    const basename = header.name.split("/").pop()!;
    if (wanted.has(basename) && !results.has(basename)) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => { results.set(basename, Buffer.concat(chunks)); callback(); });
      stream.on("error", callback);
    } else {
      stream.resume();
      stream.on("end", callback);
      stream.on("error", callback);
    }
  });

  await pipeline(Readable.fromWeb(source as any), createGunzip(), ex);
  return results;
}
