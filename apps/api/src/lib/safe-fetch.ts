// Guarded fetch for any outbound request whose URL is influenced by user input
// (competitor domains, discovered feed links, Part 13 route bodies).
//
// Blocks SSRF to private / loopback / link-local / CGNAT / ULA / multicast /
// reserved addresses: the host is resolved and every A/AAAA answer is checked
// before we connect, and every redirect hop is re-validated (redirect: "manual",
// followed by hand). Bodies are read through a size-capped reader so a hostile
// endpoint can't stream hundreds of MB into cheerio/xml2js.
//
// Residual: a DNS rebind between our dns.lookup and fetch's own resolution is
// still theoretically possible — accepted for Phase 0, same class as the
// analysis-graph AbortSignal debt (docs/tech-debt.md). Closing it needs a
// custom undici connect() pinned to the vetted IP.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5_000_000;

export const NON_PUBLIC_ADDRESS_MESSAGE = "domain resolves to a non-public address";

const BLOCKED_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
].map((cidr) => {
  const [net, bits] = cidr.split("/");
  return { net: v4ToInt(net), bits: Number(bits) };
});

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function isBlockedV4(ip: string): boolean {
  const value = v4ToInt(ip);
  return BLOCKED_V4.some(({ net, bits }) => {
    const size = 2 ** (32 - bits);
    return Math.floor(value / size) === Math.floor(net / size);
  });
}

// Expands any IPv6 literal (including a "::ffff:1.2.3.4" trailing dotted quad)
// to its 16 bytes so prefixes can be compared without a CIDR library.
function v6ToBytes(ip: string): number[] | null {
  let text = ip.replace(/^\[|\]$/g, "").split("%")[0];
  const lastColon = text.lastIndexOf(":");
  const trailer = text.slice(lastColon + 1);
  if (trailer.includes(".")) {
    if (isIP(trailer) !== 4) return null;
    const o = trailer.split(".").map(Number);
    const hi = ((o[0] << 8) | o[1]).toString(16);
    const lo = ((o[2] << 8) | o[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
    bytes.push(value >> 8, value & 0xff);
  }
  return bytes;
}

function isBlockedV6(ip: string): boolean {
  const b = v6ToBytes(ip);
  if (!b) return true;
  const zeros = (n: number) => b.slice(0, n).every((byte) => byte === 0);
  const embeddedV4 = () => b.slice(12).join(".");

  if (zeros(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedV4(embeddedV4()); // ::ffff:0:0/96
  const nat64 = b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b;
  if (nat64 && b.slice(4, 12).every((byte) => byte === 0)) return isBlockedV4(embeddedV4()); // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16 — 6to4 embeds an arbitrary v4
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32
  // Everything outside global unicast (2000::/3) is blocked: that single test
  // covers ::/128, ::1/128, fc00::/7, fe80::/10 and ff00::/8 at once.
  return (b[0] & 0xe0) !== 0x20;
}

export async function isPublicHostname(host: string): Promise<boolean> {
  const name = host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (!name) return false;

  const literal = isIP(name);
  if (literal === 4) return !isBlockedV4(name);
  if (literal === 6) return !isBlockedV6(name);

  if (!name.includes(".")) return false;
  if (name === "localhost" || name.endsWith(".local") || name.endsWith(".internal")) return false;

  try {
    const answers = await lookup(name, { all: true });
    if (answers.length === 0) return false;
    return answers.every((a) => (a.family === 4 ? !isBlockedV4(a.address) : !isBlockedV6(a.address)));
  } catch {
    return false;
  }
}

async function assertPublicUrl(input: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`invalid probe URL: ${input}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`unsupported probe URL scheme: ${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("probe URL must not carry credentials");
  }
  // Allow an explicit port when it equals the scheme default so a legit CDN
  // redirect (`Location: https://host:443/...`) is not refused; reject every
  // other explicit port. WHATWG URL already folds a default `:443`/`:80` to "",
  // so in practice only a genuinely non-default port trips this.
  const defaultPort =
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80") ||
    parsed.port === "";
  if (!defaultPort) {
    throw new Error("probe URL must not carry a non-default explicit port");
  }
  if (!(await isPublicHostname(parsed.hostname))) {
    throw new Error(NON_PUBLIC_ADDRESS_MESSAGE);
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`response body exceeded ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export interface SafeFetchInit extends RequestInit {
  maxBytes?: number;
}

export interface SafeFetchResult {
  status: number;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<SafeFetchResult> {
  const { maxBytes = DEFAULT_MAX_BYTES, ...requestInit } = init;
  let current = url;

  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...requestInit, redirect: "manual" });
    const location =
      res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;

    if (location && hop < MAX_REDIRECTS) {
      await res.body?.cancel().catch(() => undefined);
      current = new URL(location, current).toString();
      continue;
    }

    const method = (requestInit.method ?? "GET").toUpperCase();
    const body = method === "HEAD" ? "" : await readCapped(res, maxBytes);
    return {
      status: res.status,
      // The chain was followed here, so this — not res.url, which never
      // advances under redirect: "manual" — is the validated final URL.
      url: current,
      headers: res.headers,
      text: async () => body,
      json: async () => JSON.parse(body) as unknown,
    };
  }
}
