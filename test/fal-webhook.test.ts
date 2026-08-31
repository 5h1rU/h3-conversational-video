import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { verifyFalWebhook } from "../src/fal-webhook";

describe("fal webhook authentication boundary", () => {
  it("rejects missing signature headers before parsing a payload", async () => {
    const exit = await Effect.runPromiseExit(
      verifyFalWebhook({
        headers: new Headers(),
        rawBody: new TextEncoder().encode("{}"),
        nowEpochSeconds: 1000,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects stale signed deliveries before fetching JWKS", async () => {
    const headers = new Headers({
      "x-fal-webhook-request-id": "request-1",
      "x-fal-webhook-user-id": "user-1",
      "x-fal-webhook-timestamp": "1",
      "x-fal-webhook-signature": "00",
    });
    const exit = await Effect.runPromiseExit(
      verifyFalWebhook({
        headers,
        rawBody: new TextEncoder().encode("{}"),
        nowEpochSeconds: 1000,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});
