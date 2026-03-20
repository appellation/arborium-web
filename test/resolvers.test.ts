import { describe, it, expect, beforeEach, afterEach } from "@rstest/core";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { pluginVersion } from "@arborium/arborium";
import { fromNodeModules, fromNpm } from "../dist/core/resolvers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// fromNodeModules
// ============================================================================

describe("fromNodeModules", () => {
  it("resolves grammar paths for an installed package", async () => {
    const resolver = fromNodeModules();
    const result = await resolver({ languages: ["json"] });

    expect(result.grammars.size).toBe(1);

    const json = result.grammars.get("json")!;
    expect(json).toBeDefined();
    expect(json.js).toMatch(/grammar\.js$/);
    expect(json.wasm).toMatch(/grammar_bg\.wasm$/);
    expect(fs.existsSync(json.js)).toBe(true);
    expect(fs.existsSync(json.wasm)).toBe(true);
  });

  it("throws when the grammar package is not installed", () => {
    const resolver = fromNodeModules();
    expect(() =>
      resolver({ languages: ["not-a-real-language"] }),
    ).toThrow();
  });
});

// ============================================================================
// fromNpm helpers
// ============================================================================

/** Build a minimal ustar tar+gzip buffer containing the given files. */
function buildTarGz(files: Record<string, Buffer | string>): Buffer {
  const blocks: Buffer[] = [];

  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const tarName = `package/${name}`;

    const header = Buffer.alloc(512, 0);
    header.write(tarName.slice(0, 99), 0, "utf8");
    header.write("0000644\0", 100, "utf8");
    header.write("0001750\0", 108, "utf8");
    header.write("0001750\0", 116, "utf8");
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");
    header.write("00000000000\0", 136, "utf8");
    header[156] = 0x30; // regular file

    // Checksum: treat bytes 148-155 as spaces during summation
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += header[i];
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");

    blocks.push(header);

    const padded = Math.ceil(data.length / 512) * 512;
    const dataBlock = Buffer.alloc(padded, 0);
    data.copy(dataBlock);
    blocks.push(dataBlock);
  }

  blocks.push(Buffer.alloc(1024, 0)); // end-of-archive
  return gzipSync(Buffer.concat(blocks));
}

const FAKE_JS = `export default function init() {} export function language_id() { return "json"; }`;
const FAKE_WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]); // WASM magic

// ============================================================================
// fromNpm
// ============================================================================

describe("fromNpm", () => {
  let cacheDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "arborium-test-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  function mockFetch(tarball: Buffer) {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("registry.npmjs.org")) {
        return new Response(
          JSON.stringify({ dist: { tarball: "http://fake/pkg.tgz" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith(".tgz")) {
        return new Response(new Uint8Array(tarball), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };
  }

  it("fetches from the registry and extracts grammar files", async () => {
    const tarball = buildTarGz({ "grammar.js": FAKE_JS, "grammar_bg.wasm": FAKE_WASM });
    mockFetch(tarball);

    const resolver = fromNpm({ cacheDir });
    const result = await resolver({ languages: ["json"] });

    const json = result.grammars.get("json")!;
    expect(json).toBeDefined();
    expect(fs.existsSync(json.js)).toBe(true);
    expect(fs.existsSync(json.wasm)).toBe(true);
    expect(fs.readFileSync(json.js, "utf8")).toBe(FAKE_JS);
    expect(fs.readFileSync(json.wasm)).toEqual(FAKE_WASM);
  });

  it("caches files and skips the network on subsequent calls", async () => {
    const tarball = buildTarGz({ "grammar.js": FAKE_JS, "grammar_bg.wasm": FAKE_WASM });
    mockFetch(tarball);

    const resolver = fromNpm({ cacheDir });
    await resolver({ languages: ["json"] });

    // Remove fetch so any network call would throw
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch should not be called on cache hit");
    };

    const result = await resolver({ languages: ["json"] });
    expect(fetchCalled).toBe(false);

    const json = result.grammars.get("json")!;
    expect(fs.existsSync(json.js)).toBe(true);
    expect(fs.existsSync(json.wasm)).toBe(true);
  });

  it("throws a descriptive error when the registry returns 404", async () => {
    globalThis.fetch = async () => new Response("Not Found", { status: 404, statusText: "Not Found" });

    const resolver = fromNpm({ cacheDir });
    await expect(resolver({ languages: ["unknown-lang"] })).rejects.toThrow(
      "@arborium/unknown-lang",
    );
  });

  it("throws when grammar.js is missing from the tarball", async () => {
    // Only include the wasm, omit grammar.js
    const tarball = buildTarGz({ "grammar_bg.wasm": FAKE_WASM });
    mockFetch(tarball);

    const resolver = fromNpm({ cacheDir });
    await expect(resolver({ languages: ["json"] })).rejects.toThrow(
      "grammar.js",
    );
  });

  it("throws when grammar_bg.wasm is missing from the tarball", async () => {
    // Only include the js, omit the wasm
    const tarball = buildTarGz({ "grammar.js": FAKE_JS });
    mockFetch(tarball);

    const resolver = fromNpm({ cacheDir });
    await expect(resolver({ languages: ["json"] })).rejects.toThrow(
      "grammar_bg.wasm",
    );
  });

  it("requests the pinned pluginVersion from the registry", async () => {
    const tarball = buildTarGz({ "grammar.js": FAKE_JS, "grammar_bg.wasm": FAKE_WASM });
    const requestedUrls: string[] = [];

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input.toString();
      requestedUrls.push(url);
      if (url.includes("registry.npmjs.org")) {
        return new Response(
          JSON.stringify({ dist: { tarball: "http://fake/pkg.tgz" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith(".tgz")) {
        return new Response(new Uint8Array(tarball), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    const resolver = fromNpm({ cacheDir });
    await resolver({ languages: ["json"] });

    const metaUrl = requestedUrls.find((u) => u.includes("registry.npmjs.org"))!;
    expect(metaUrl).toContain(pluginVersion);
    expect(metaUrl).not.toContain("latest");
  });

  it("cache is keyed by version — different versions do not share cache entries", async () => {
    const tarball = buildTarGz({ "grammar.js": FAKE_JS, "grammar_bg.wasm": FAKE_WASM });
    let fetchCount = 0;

    globalThis.fetch = async (input: RequestInfo | URL) => {
      fetchCount++;
      const url = input.toString();
      if (url.includes("registry.npmjs.org")) {
        return new Response(
          JSON.stringify({ dist: { tarball: "http://fake/pkg.tgz" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith(".tgz")) {
        return new Response(new Uint8Array(tarball), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    };

    // First resolver populates the cache for pluginVersion
    const resolver = fromNpm({ cacheDir });
    await resolver({ languages: ["json"] });
    const fetchesAfterFirst = fetchCount;

    // Manually plant a different-version cache entry to simulate a stale cache
    const staleVersionDir = path.join(
      cacheDir,
      "@arborium",
      "json",
      "0.0.0-stale",
    );
    fs.mkdirSync(staleVersionDir, { recursive: true });
    fs.writeFileSync(path.join(staleVersionDir, "grammar.js"), FAKE_JS);
    fs.writeFileSync(path.join(staleVersionDir, "grammar_bg.wasm"), FAKE_WASM);

    // Second call should still hit the pluginVersion cache, not the stale entry
    await resolver({ languages: ["json"] });
    expect(fetchCount).toBe(fetchesAfterFirst); // no additional fetches
  });

  it("resolves multiple languages in parallel", async () => {
    const tarball = buildTarGz({ "grammar.js": FAKE_JS, "grammar_bg.wasm": FAKE_WASM });
    mockFetch(tarball);

    const resolver = fromNpm({ cacheDir });
    const result = await resolver({ languages: ["json", "toml"] });

    expect(result.grammars.size).toBe(2);
    expect(result.grammars.has("json")).toBe(true);
    expect(result.grammars.has("toml")).toBe(true);
  });
});
