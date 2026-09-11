import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

import { isPublicHostname, safeFetch } from "@/lib/safe-fetch";

const PUBLIC_ANSWER = [{ address: "93.184.216.34", family: 4 }];

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

describe("lib/safe-fetch — isPublicHostname", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.5",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.0.0.1",
    "192.0.2.5",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
  ])("rejects the reserved IPv4 literal %s", async (ip) => {
    await expect(isPublicHostname(ip)).resolves.toBe(false);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.255.255"])(
    "allows the public IPv4 literal %s",
    async (ip) => {
      await expect(isPublicHostname(ip)).resolves.toBe(true);
    }
  );

  it.each([
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2002:0a00:0001::1",
    "2001:db8::1",
  ])("rejects the non-public IPv6 literal %s", async (ip) => {
    await expect(isPublicHostname(ip)).resolves.toBe(false);
  });

  it.each(["2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"])(
    "allows the public IPv6 literal %s",
    async (ip) => {
      await expect(isPublicHostname(ip)).resolves.toBe(true);
    }
  );

  it.each(["", "   ", "localhost", "dotless", "printer.local", "vault.internal"])(
    "rejects the non-routable hostname %s without resolving it",
    async (host) => {
      await expect(isPublicHostname(host)).resolves.toBe(false);
      expect(lookupMock).not.toHaveBeenCalled();
    }
  );

  // Wildcard-DNS and attacker-controlled A records are the bypasses the old
  // lexical-only guard missed (review H-1).
  it("rejects a syntactically fine hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    await expect(isPublicHostname("probe.attacker.com")).resolves.toBe(false);
  });

  it("rejects a wildcard-DNS host resolving to link-local metadata", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(isPublicHostname("169.254.169.254.nip.io")).resolves.toBe(false);
  });

  it("rejects when any single answer in a multi-record set is private", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(isPublicHostname("mixed.example.com")).resolves.toBe(false);
  });

  it("rejects an AAAA answer inside a blocked IPv6 range", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "fd00::1", family: 6 }]);
    await expect(isPublicHostname("v6.example.com")).resolves.toBe(false);
  });

  it.each([
    ["an empty answer set", [] as unknown[]],
    ["a failed lookup", null],
  ])("rejects %s", async (_label, answer) => {
    if (answer === null) lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    else lookupMock.mockResolvedValueOnce(answer);
    await expect(isPublicHostname("nothing.example.com")).resolves.toBe(false);
  });

  it("allows a host whose every answer is public", async () => {
    await expect(isPublicHostname("acme.com")).resolves.toBe(true);
    expect(lookupMock).toHaveBeenCalledWith("acme.com", { all: true });
  });
});

describe("lib/safe-fetch — safeFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue(PUBLIC_ANSWER);
    fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["a non-http scheme", "file:///etc/passwd"],
    ["userinfo", "https://user@acme.com/"],
    ["an explicit port", "https://acme.com:8080/"],
    ["a malformed URL", "not a url"],
  ])("refuses to fetch %s", async (_label, url) => {
    await expect(safeFetch(url)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows an explicit port that equals the scheme default", async () => {
    fetchMock.mockResolvedValueOnce(new Response("plans"));
    const res = await safeFetch("https://acme.com:443/pricing");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to fetch a host that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    await expect(safeFetch("https://probe.attacker.com/")).rejects.toThrow(
      "domain resolves to a non-public address"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never lets node fetch follow redirects on its own", async () => {
    await safeFetch("https://acme.com/", { method: "HEAD" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://acme.com/",
      expect.objectContaining({ redirect: "manual", method: "HEAD" })
    );
  });

  it("re-validates every redirect hop and reports the final URL", async () => {
    fetchMock
      .mockResolvedValueOnce(redirectTo("https://cdn.acme.com/pricing"))
      .mockResolvedValueOnce(new Response("plans"));

    const res = await safeFetch("https://acme.com/pricing");

    expect(res.url).toBe("https://cdn.acme.com/pricing");
    expect(await res.text()).toBe("plans");
    expect(lookupMock).toHaveBeenCalledWith("cdn.acme.com", { all: true });
  });

  it("resolves a relative Location against the current hop", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo("/plans")).mockResolvedValueOnce(new Response("plans"));

    const res = await safeFetch("https://acme.com/pricing");

    expect(fetchMock.mock.calls[1][0]).toBe("https://acme.com/plans");
    expect(res.url).toBe("https://acme.com/plans");
  });

  // H-2: a domain that passes the guard 302s to the metadata endpoint.
  it("blocks a redirect into link-local space instead of following it", async () => {
    fetchMock.mockResolvedValueOnce(redirectTo("http://169.254.169.254/latest/meta-data/"));

    await expect(safeFetch("https://acme.com/pricing")).rejects.toThrow(
      "domain resolves to a non-public address"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops following after five hops and returns the last redirect response", async () => {
    fetchMock.mockImplementation(async () => redirectTo("https://acme.com/next"));

    const res = await safeFetch("https://acme.com/");

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(res.status).toBe(302);
  });

  it("aborts a body that exceeds maxBytes instead of buffering it", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(5_000)));

    await expect(safeFetch("https://acme.com/", { maxBytes: 1_000 })).rejects.toThrow(
      "exceeded 1000 bytes"
    );
  });

  it("returns status, headers and a parsed JSON body within the cap", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ jobs: [1] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const res = await safeFetch("https://boards-api.greenhouse.io/v1/boards/acme/jobs");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ jobs: [1] });
  });

  it("does not read a body for a HEAD probe", async () => {
    const body = new Response("should not be read");
    const spy = vi.spyOn(body, "body", "get");
    fetchMock.mockResolvedValueOnce(body);

    const res = await safeFetch("https://acme.com/pricing", { method: "HEAD" });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(spy).not.toHaveBeenCalled();
  });
});
