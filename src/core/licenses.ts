import { pluginVersion } from "@arborium/arborium";

const GITHUB_API = "https://api.github.com/repos/bearcove/arborium/contents";
const GITHUB_RAW = "https://raw.githubusercontent.com/bearcove/arborium";
const ref = `v${pluginVersion}`;

// lang → group, built lazily from the GitHub contents API
const langGroupCache = new Map<string, string>();
let langGroupMapPromise: Promise<void> | null = null;

async function ensureLangGroupMap(): Promise<void> {
  if (langGroupMapPromise) return langGroupMapPromise;

  langGroupMapPromise = (async () => {
    const groupsRes = await fetch(`${GITHUB_API}/langs?ref=${ref}`);
    if (!groupsRes.ok) {
      throw new Error(
        `unplugin-arborium: failed to list lang groups from arborium repo (${groupsRes.status} ${groupsRes.statusText})`,
      );
    }
    const groups: Array<{ name: string; type: string }> = await groupsRes.json();

    await Promise.all(
      groups
        .filter((g) => g.type === "dir")
        .map(async ({ name: group }) => {
          const langsRes = await fetch(
            `${GITHUB_API}/langs/${group}?ref=${ref}`,
          );
          if (!langsRes.ok) return;
          const langs: Array<{ name: string; type: string }> =
            await langsRes.json();
          for (const { name: lang, type } of langs) {
            if (type === "dir") langGroupCache.set(lang, group);
          }
        }),
    );
  })();

  return langGroupMapPromise;
}

const licenseCache = new Map<string, string>();

export function _clearLicenseCache(): void {
  licenseCache.clear();
  langGroupCache.clear();
  langGroupMapPromise = null;
}

async function fetchLicense(lang: string): Promise<string> {
  const cached = licenseCache.get(lang);
  if (cached !== undefined) return cached;

  await ensureLangGroupMap();

  const group = langGroupCache.get(lang);
  if (!group) {
    throw new Error(
      `unplugin-arborium: unknown language "${lang}" — cannot resolve license`,
    );
  }

  const url = `${GITHUB_RAW}/${ref}/langs/${group}/${lang}/def/arborium.yaml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `unplugin-arborium: failed to fetch license metadata for "${lang}" from ${url} (${res.status} ${res.statusText})`,
    );
  }

  const text = await res.text();
  const match = text.match(/^license:\s*(.+)$/m);
  if (!match) {
    throw new Error(
      `unplugin-arborium: could not parse license field from arborium.yaml for "${lang}"`,
    );
  }

  const license = match[1].trim();
  licenseCache.set(lang, license);
  return license;
}

export async function checkLicenses(
  languages: string[],
  allowedLicenses: string[] | undefined,
): Promise<void> {
  if (allowedLicenses === undefined) return;

  const allowed = new Set(allowedLicenses);
  const violations: Array<{ lang: string; license: string }> = [];

  await Promise.all(
    languages.map(async (lang) => {
      const license = await fetchLicense(lang);
      if (!allowed.has(license)) {
        violations.push({ lang, license });
      }
    }),
  );

  if (violations.length > 0) {
    const details = violations
      .sort((a, b) => a.lang.localeCompare(b.lang))
      .map(({ lang, license }) => `  ${lang}: ${license}`)
      .join("\n");
    throw new Error(
      `unplugin-arborium: the following languages have licenses not in [${[...allowed].join(", ")}]:\n${details}`,
    );
  }
}
