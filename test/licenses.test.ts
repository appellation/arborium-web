import { describe, it, expect, beforeEach, afterEach } from "@rstest/core";
import { checkLicenses, _clearLicenseCache } from "../dist/core/licenses.js";

/**
 * Creates a mock fetch that handles the three URL types involved in license resolution:
 *   1. GitHub API  — /contents/langs?ref=...          → group directory listing
 *   2. GitHub API  — /contents/langs/{group}?ref=...  → language directory listing
 *   3. raw GitHub  — /langs/{group}/{lang}/def/arborium.yaml → YAML with license field
 *
 * All languages are placed in a single "group-test" group for simplicity.
 */
function createMockFetch(
  licenses: Record<string, string>,
  onFetch?: (url: string) => void,
) {
  const group = "group-test";
  const langs = Object.keys(licenses);

  return async (input: RequestInfo | URL) => {
    const url = input.toString();
    onFetch?.(url);

    if (url.includes("/contents/langs?")) {
      return new Response(JSON.stringify([{ name: group, type: "dir" }]), {
        status: 200,
      });
    }

    if (url.includes(`/contents/langs/${group}?`)) {
      return new Response(
        JSON.stringify(langs.map((lang) => ({ name: lang, type: "dir" }))),
        { status: 200 },
      );
    }

    for (const [lang, license] of Object.entries(licenses)) {
      if (url.includes(`/${lang}/def/arborium.yaml`)) {
        return new Response(`license: ${license}\n`, { status: 200 });
      }
    }

    return new Response("Not Found", { status: 404, statusText: "Not Found" });
  };
}

describe("checkLicenses", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _clearLicenseCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("allows all licenses when allowedLicenses is undefined", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    };

    await expect(checkLicenses(["json", "rust"], undefined)).resolves.toBeUndefined();
    expect(fetchCalled).toBe(false);
  });

  it("rejects all licenses when allowedLicenses is empty", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT" });

    await expect(checkLicenses(["json"], [])).rejects.toThrow("json");
  });

  it("passes when the language license is in the allowed set", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT" });

    await expect(checkLicenses(["json"], ["MIT"])).resolves.toBeUndefined();
  });

  it("fails when the language license is not in the allowed set", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT" });

    await expect(checkLicenses(["json"], ["Apache-2.0"])).rejects.toThrow("json: MIT");
  });

  it("error message lists all violating languages", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT", rust: "MIT" });

    const error = await checkLicenses(["json", "rust"], ["Apache-2.0"]).catch((e) => e);
    expect(error.message).toContain("json: MIT");
    expect(error.message).toContain("rust: MIT");
  });

  it("passes languages individually — only violators are reported", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT", rust: "Apache-2.0" });

    const error = await checkLicenses(["json", "rust"], ["MIT"]).catch((e) => e);
    expect(error.message).toContain("rust: Apache-2.0");
    expect(error.message).not.toContain("json");
  });

  it("throws for an unknown language", async () => {
    globalThis.fetch = createMockFetch({}); // no languages in the group map

    await expect(
      checkLicenses(["not-a-real-language"], ["MIT"]),
    ).rejects.toThrow("not-a-real-language");
  });

  it("caches license results and does not re-fetch on repeated calls", async () => {
    globalThis.fetch = createMockFetch({ json: "MIT" });

    // First call populates both the lang→group map and the license cache
    await checkLicenses(["json"], ["MIT"]);

    // Second call should hit the license cache with no fetches at all
    let fetchesDuringSecond = 0;
    globalThis.fetch = async () => {
      fetchesDuringSecond++;
      throw new Error("fetch should not be called on cache hit");
    };

    await checkLicenses(["json"], ["MIT"]);
    expect(fetchesDuringSecond).toBe(0);
  });

  it("builds the lang→group map once and reuses it across languages", async () => {
    const apiCallUrls: string[] = [];
    globalThis.fetch = createMockFetch({ json: "MIT", rust: "MIT" }, (url) => {
      if (url.includes("api.github.com")) apiCallUrls.push(url);
    });

    await checkLicenses(["json", "rust"], ["MIT"]);

    // Exactly one groups listing + one group-contents listing, regardless of language count
    const groupsListingCalls = apiCallUrls.filter((u) => u.includes("/contents/langs?"));
    const langListingCalls = apiCallUrls.filter((u) => u.includes("/contents/langs/group-test?"));
    expect(groupsListingCalls).toHaveLength(1);
    expect(langListingCalls).toHaveLength(1);
  });

  it("throws when the groups API returns a non-200 response", async () => {
    globalThis.fetch = async () =>
      new Response("Not Found", { status: 404, statusText: "Not Found" });

    await expect(checkLicenses(["json"], ["MIT"])).rejects.toThrow("404");
  });

  it("throws when the arborium.yaml fetch returns a non-200 response", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input.toString();
      // Group discovery succeeds
      if (url.includes("/contents/langs?")) {
        return new Response(JSON.stringify([{ name: "group-test", type: "dir" }]), { status: 200 });
      }
      if (url.includes("/contents/langs/group-test?")) {
        return new Response(JSON.stringify([{ name: "json", type: "dir" }]), { status: 200 });
      }
      // YAML fetch fails
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    };

    await expect(checkLicenses(["json"], ["MIT"])).rejects.toThrow("404");
  });

  it("throws when the arborium.yaml has no license field", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/contents/langs?")) {
        return new Response(JSON.stringify([{ name: "group-test", type: "dir" }]), { status: 200 });
      }
      if (url.includes("/contents/langs/group-test?")) {
        return new Response(JSON.stringify([{ name: "json", type: "dir" }]), { status: 200 });
      }
      return new Response("repo: https://github.com/tree-sitter/tree-sitter-json\n", { status: 200 });
    };

    await expect(checkLicenses(["json"], ["MIT"])).rejects.toThrow(
      "could not parse license",
    );
  });
});
