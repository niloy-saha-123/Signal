// Turns whatever someone pastes ("https://www.Kestrel.dev/pricing?x=1",
// "kestrel.dev", "  KESTREL.DEV/ ") into a bare hostname, or null when it is
// not a plausible public domain. Used before a domain travels in a URL, so it
// is strict: letters, digits, hyphens and dots only, a real TLD, no ports,
// no credentials, no IP literals, no localhost.
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value || value.length > 253 + 12) return null;

  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  if (value.includes("@")) return null;
  value = value.split(/[/?#]/, 1)[0] ?? "";
  if (value.includes(":")) return null;
  value = value.replace(/\.$/, "");
  if (value.startsWith("www.")) value = value.slice(4);

  const labels = value.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL.test(label))) return null;
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return null;
  if (value === "localhost" || value.endsWith(".localhost") || value.endsWith(".local")) return null;

  return value;
}
