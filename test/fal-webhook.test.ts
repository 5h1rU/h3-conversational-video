import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { errorResponse } from "../src/errors";
import {
  decodeFalWebhookBody,
  verifyAndDecodeFalWebhook,
  verifyFalWebhook,
} from "../src/fal-webhook";
import { ProviderPayloadError } from "../src/services";

function webhookBody(url: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      request_id: "request-1",
      gateway_request_id: "request-1",
      status: "OK",
      payload: {
        video: {
          url,
          content_type: "video/mp4",
          file_name: "generated.mp4",
          file_size: 6_463_396,
        },
        expanded_prompt: null,
      },
    }),
  );
}

describe("fal webhook authentication boundary", () => {
  it("rejects missing signature headers before parsing a payload", async () => {
    const exit = await Effect.runPromiseExit(
      verifyAndDecodeFalWebhook({
        headers: new Headers(),
        rawBody: new TextEncoder().encode("not json"),
        nowEpochSeconds: 1000,
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("WebhookAuthorizationError");
      expect(String(exit.cause)).not.toContain("ProviderPayloadError");
    }
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

  it("decodes the official JSON video URL string into the internal URL type", async () => {
    const decoded = await Effect.runPromise(
      decodeFalWebhookBody(
        webhookBody("https://v3b.fal.media/files/example/generated-video.mp4"),
      ),
    );
    expect(decoded.status).toBe("OK");
    if (decoded.status !== "OK") throw new Error("expected OK webhook");
    expect(decoded.payload?.video.url).toBeInstanceOf(URL);
    expect(decoded.payload?.video.url.protocol).toBe("https:");
    expect(decoded.payload?.expanded_prompt).toBeNull();
  });

  it("maps malformed and unsafe URL strings to a typed payload error", async () => {
    for (const url of [
      "not-a-url",
      "http://v3b.fal.media/video.mp4",
      "https://localhost/video.mp4",
      "https://example.com/video.mp4",
    ]) {
      const exit = await Effect.runPromiseExit(
        decodeFalWebhookBody(webhookBody(url)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(String(exit.cause)).toContain("ProviderPayloadError");
        expect(String(exit.cause)).not.toContain("SchemaError(Expected URL");
      }
    }
  });

  it("returns an intentional client response for invalid provider payloads", async () => {
    const response = errorResponse(
      new ProviderPayloadError({
        code: "FAL_WEBHOOK_PAYLOAD_INVALID",
        message: "fal webhook payload did not match the expected wire schema",
      }),
      "request-log-id",
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FAL_WEBHOOK_PAYLOAD_INVALID" },
    });
  });
});
