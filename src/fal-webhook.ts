import { Effect, Schema } from "effect";
import { FalWebhookJsonWire } from "./domain";
import { ProviderPayloadError, WebhookAuthorizationError } from "./services";

const FalJwks = Schema.Struct({
  keys: Schema.Array(Schema.Struct({ x: Schema.NonEmptyString })),
});
const decodeJwks = Schema.decodeUnknownSync(FalJwks);
const decodeTimestamp = Schema.decodeUnknownSync(Schema.NumberFromString);
const decodeFalWebhookJson = Schema.decodeUnknownEffect(FalWebhookJsonWire);

export const decodeFalWebhookBody = Effect.fn("decodeFalWebhookBody")(
  (rawBody: Uint8Array) =>
    decodeFalWebhookJson(new TextDecoder().decode(rawBody)).pipe(
      Effect.mapError(
        () =>
          new ProviderPayloadError({
            code: "FAL_WEBHOOK_PAYLOAD_INVALID",
            message:
              "fal webhook payload did not match the expected wire schema",
          }),
      ),
    ),
);

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0)
    throw new Error("Invalid signature hex");
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(normalized), (character) =>
    character.charCodeAt(0),
  );
}

function hex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ownedBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

export interface VerifiedFalWebhook {
  readonly requestId: string;
  readonly signatureTimestamp: number;
}

export const verifyFalWebhook = Effect.fn("verifyFalWebhook")(
  function* (input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
    readonly nowEpochSeconds: number;
  }) {
    const requestId = input.headers.get("x-fal-webhook-request-id");
    const userId = input.headers.get("x-fal-webhook-user-id");
    const timestampText = input.headers.get("x-fal-webhook-timestamp");
    const signatureText = input.headers.get("x-fal-webhook-signature");
    if (!requestId || !userId || !timestampText || !signatureText) {
      return yield* new WebhookAuthorizationError({
        message: "Missing fal webhook signature headers",
      });
    }
    const verified = yield* Effect.tryPromise({
      try: async () => {
        const timestamp = decodeTimestamp(timestampText);
        if (
          !Number.isInteger(timestamp) ||
          Math.abs(input.nowEpochSeconds - timestamp) > 300
        ) {
          throw new Error("Webhook timestamp outside five-minute tolerance");
        }
        const bodyHash = hex(
          await crypto.subtle.digest("SHA-256", ownedBuffer(input.rawBody)),
        );
        const message = new TextEncoder().encode(
          [requestId, userId, timestampText, bodyHash].join("\n"),
        );
        const signature = fromHex(signatureText);
        const cache = await caches.open("fal-webhook-jwks");
        const cacheKey = new Request(
          "https://rest.fal.ai/.well-known/jwks.json",
        );
        let response = await cache.match(cacheKey);
        if (!response) {
          response = await fetch(cacheKey);
          if (!response.ok)
            throw new Error(`fal JWKS request failed with ${response.status}`);
          const cached = new Response(response.body, response);
          cached.headers.set("Cache-Control", "public, max-age=3600");
          await cache.put(cacheKey, cached);
        }
        const jwks = decodeJwks(await response.json());
        for (const key of jwks.keys) {
          const publicKey = await crypto.subtle.importKey(
            "raw",
            ownedBuffer(fromBase64Url(key.x)),
            "Ed25519",
            false,
            ["verify"],
          );
          if (
            await crypto.subtle.verify(
              "Ed25519",
              publicKey,
              ownedBuffer(signature),
              ownedBuffer(message),
            )
          ) {
            return {
              requestId,
              signatureTimestamp: timestamp,
            } satisfies VerifiedFalWebhook;
          }
        }
        throw new Error("Signature did not match any fal JWKS key");
      },
      catch: (cause) =>
        new WebhookAuthorizationError({ message: String(cause) }),
    });
    return verified;
  },
);

export const verifyAndDecodeFalWebhook = Effect.fn("verifyAndDecodeFalWebhook")(
  function* (input: {
    readonly headers: Headers;
    readonly rawBody: Uint8Array;
    readonly nowEpochSeconds: number;
  }) {
    const verified = yield* verifyFalWebhook(input);
    const webhook = yield* decodeFalWebhookBody(input.rawBody);
    return { verified, webhook };
  },
);
