import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySlackRequest, SLACK_TIMESTAMP_TOLERANCE_SECONDS } from "@/integrations/slack/verify";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const BODY = "token=abc&team_id=T123&command=%2Fsignal&text=what+changed";

function sign(body: string, timestamp: string, secret = SECRET): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${crypto.createHmac("sha256", secret).update(base).digest("hex")}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

describe("verifySlackRequest", () => {
  it("accepts a correctly signed, fresh request", () => {
    const ts = String(nowSeconds());

    expect(
      verifySlackRequest({ body: BODY, timestamp: ts, signature: sign(BODY, ts), secret: SECRET })
    ).toBe(true);
  });

  it("rejects a replayed request from outside the tolerance window", () => {
    // The signature stays valid forever, so the timestamp window is the only
    // thing standing between a captured request and unlimited replay.
    const old = String(nowSeconds() - (SLACK_TIMESTAMP_TOLERANCE_SECONDS + 60));

    expect(
      verifySlackRequest({ body: BODY, timestamp: old, signature: sign(BODY, old), secret: SECRET })
    ).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    const future = String(nowSeconds() + (SLACK_TIMESTAMP_TOLERANCE_SECONDS + 60));

    expect(
      verifySlackRequest({
        body: BODY,
        timestamp: future,
        signature: sign(BODY, future),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects a tampered body carrying an otherwise valid signature", () => {
    const ts = String(nowSeconds());
    const signature = sign(BODY, ts);

    expect(
      verifySlackRequest({ body: `${BODY}&injected=1`, timestamp: ts, signature, secret: SECRET })
    ).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const ts = String(nowSeconds());

    expect(
      verifySlackRequest({
        body: BODY,
        timestamp: ts,
        signature: sign(BODY, ts, "the-wrong-secret"),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects a missing or malformed signature without throwing", () => {
    const ts = String(nowSeconds());

    for (const signature of ["", "not-a-signature", "v0=", "v1=abc"]) {
      expect(
        verifySlackRequest({ body: BODY, timestamp: ts, signature, secret: SECRET })
      ).toBe(false);
    }
  });

  it("rejects a non-numeric timestamp without throwing", () => {
    expect(
      verifySlackRequest({
        body: BODY,
        timestamp: "yesterday",
        signature: sign(BODY, "yesterday"),
        secret: SECRET,
      })
    ).toBe(false);
  });

  it("rejects when no signing secret is configured", () => {
    // An unset secret must fail closed. Treating "no secret" as "skip the check"
    // would leave the endpoint wide open on any deploy that forgot the variable.
    const ts = String(nowSeconds());

    expect(
      verifySlackRequest({ body: BODY, timestamp: ts, signature: sign(BODY, ts), secret: "" })
    ).toBe(false);
  });

  it("compares signatures of differing length without throwing", () => {
    // timingSafeEqual throws on length mismatch; a crash here would be a 500 on
    // an unauthenticated endpoint.
    const ts = String(nowSeconds());

    expect(
      verifySlackRequest({ body: BODY, timestamp: ts, signature: "v0=abcd", secret: SECRET })
    ).toBe(false);
  });
});
