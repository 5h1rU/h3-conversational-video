import { Effect, Predicate } from "effect";
import { decodeBranchGenerationJob, decodeSessionState } from "./domain";
import { demoHtml, fixtureSvg } from "./demo";
import { errorResponse, AppError } from "./errors";
import { verifyAndDecodeFalWebhook } from "./fal-webhook";
import {
  appConfigLive,
  artifactStoreLive,
  auditLedgerLive,
  generationProviderLive,
  sessionPublisherLive,
} from "./layers";
import { log } from "./observability";
import { AppConfig, AuditLedger } from "./services";
import { ingestProviderResult } from "./use-cases/ingest-provider-result";
import { submitGeneration } from "./use-cases/submit-generation";

export { SessionDurableObject } from "./session-do";

async function jsonBody(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 64 * 1024)
    throw new AppError("PAYLOAD_TOO_LARGE", "JSON body exceeds 64 KiB", 413);
  return request.json();
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(demoHtml, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const fixtureMatch = url.pathname.match(
    /^\/v1\/fixtures\/(\d+|reentry)\.svg$/,
  );
  if (request.method === "GET" && fixtureMatch?.[1]) {
    return new Response(fixtureSvg(fixtureMatch[1]), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/sessions") {
    const body = await jsonBody(request);
    const payload = Predicate.isObject(body) ? body : {};
    const requestedId =
      Predicate.hasProperty(payload, "sessionId") &&
      Predicate.isString(payload.sessionId)
        ? payload.sessionId
        : crypto.randomUUID();
    const stub = env.SESSIONS.getByName(requestedId);
    const state = await stub.initialize({
      ...payload,
      sessionId: requestedId,
    });
    const decodedState = decodeSessionState(state);
    await Effect.runPromise(
      AuditLedger.use((audit) =>
        audit.recordSession({
          sessionId: decodedState.sessionId,
          showId: decodedState.showId,
          episodeId: decodedState.episodeId,
          showVersion: decodedState.showVersion,
          at: new Date().toISOString(),
        }),
      ).pipe(Effect.provide(auditLedgerLive(env.DB))),
    );
    return Response.json(state, { status: 201 });
  }
  const sessionMatch = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/(events|state|playlist|ws)$/,
  );
  if (sessionMatch?.[1] && sessionMatch[2]) {
    const stub = env.SESSIONS.getByName(sessionMatch[1]);
    if (sessionMatch[2] === "ws" && request.method === "GET")
      return stub.fetch(request);
    if (sessionMatch[2] === "state" && request.method === "GET")
      return Response.json(await stub.getState());
    if (sessionMatch[2] === "playlist" && request.method === "GET")
      return Response.json(await stub.getPlaylist());
    if (sessionMatch[2] === "events" && request.method === "POST") {
      const body = await jsonBody(request);
      const result = await stub.acceptEvent(body);
      const decodedState = decodeSessionState(result.state);
      if (!result.accepted) {
        return Response.json(
          { error: result.error, state: result.state },
          { status: 409 },
        );
      }
      if (!result.duplicate) {
        await Effect.runPromise(
          AuditLedger.use((audit) =>
            audit.recordViewerEvent({
              eventId: result.event.eventId,
              sessionId: decodedState.sessionId,
              transcript: result.event.text,
              playbackMs: result.event.playbackPositionMs,
              at: new Date().toISOString(),
            }),
          ).pipe(Effect.provide(auditLedgerLive(env.DB))),
        );
      }
      return Response.json(result, { status: result.duplicate ? 200 : 202 });
    }
  }
  const mediaMatch = url.pathname.match(
    /^\/v1\/sessions\/([^/]+)\/media\/(sha256:[a-f0-9]{64})$/,
  );
  if (request.method === "GET" && mediaMatch?.[1] && mediaMatch[2]) {
    const ownsArtifact = await env.SESSIONS.getByName(
      mediaMatch[1],
    ).ownsArtifact(mediaMatch[2]);
    if (!ownsArtifact)
      throw new AppError(
        "MEDIA_FORBIDDEN",
        "Artifact is not committed to this session",
        403,
      );
    const digest = mediaMatch[2].slice("sha256:".length);
    const manifestObject = await env.MEDIA.get(
      `artifacts/sha256/${digest}/manifest.v1.json`,
    );
    if (!manifestObject)
      throw new AppError(
        "MEDIA_NOT_FOUND",
        "Committed artifact not found",
        404,
      );
    const manifest = await manifestObject.json<{ mediaKey: string }>();
    const isRangeRequest = request.headers.has("Range");
    const object = isRangeRequest
      ? await env.MEDIA.get(manifest.mediaKey, { range: request.headers })
      : await env.MEDIA.get(manifest.mediaKey);
    if (!object || !object.body)
      throw new AppError("MEDIA_NOT_FOUND", "Committed media not found", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Accept-Ranges", "bytes");
    if (isRangeRequest && object.range) {
      const offset = "offset" in object.range ? object.range.offset : 0;
      const length =
        "length" in object.range ? object.range.length : object.size;
      headers.set(
        "Content-Range",
        `bytes ${offset}-${offset + length - 1}/${object.size}`,
      );
    }
    return new Response(object.body, {
      status: isRangeRequest ? 206 : 200,
      headers,
    });
  }
  if (request.method === "POST" && url.pathname === "/v1/webhooks/fal") {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > 1024 * 1024)
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        "Webhook body exceeds 1 MiB",
        413,
      );
    const rawBody = new Uint8Array(await request.arrayBuffer());
    const { verified, webhook } = await Effect.runPromise(
      verifyAndDecodeFalWebhook({
        headers: request.headers,
        rawBody,
        nowEpochSeconds: Math.floor(Date.now() / 1000),
      }),
    );
    const config = await Effect.runPromise(
      AppConfig.use((service) => Effect.succeed(service)).pipe(
        Effect.provide(appConfigLive(env)),
      ),
    );
    const result = await Effect.runPromise(
      ingestProviderResult({ webhook, verified }).pipe(
        Effect.provide(auditLedgerLive(env.DB)),
        Effect.provide(artifactStoreLive(env.MEDIA)),
        Effect.provide(generationProviderLive(config)),
        Effect.provide(sessionPublisherLive(env.SESSIONS)),
      ),
    );
    return Response.json(result);
  }
  throw new AppError("NOT_FOUND", "Route not found", 404);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const started = Date.now();
    try {
      const response = await handleRequest(request, env);
      log("info", "request.completed", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      return errorResponse(error, requestId);
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const configLayer = appConfigLive(env);
    const config = await Effect.runPromise(
      AppConfig.use((service) => Effect.succeed(service)).pipe(
        Effect.provide(configLayer),
      ),
    );
    for (const message of batch.messages) {
      let job;
      try {
        job = await Effect.runPromise(decodeBranchGenerationJob(message.body));
      } catch (error) {
        log("error", "queue.invalid_payload", {
          messageId: message.id,
          error: String(error),
        });
        message.ack();
        continue;
      }
      try {
        const result = await Effect.runPromise(
          submitGeneration(job).pipe(
            Effect.provide(auditLedgerLive(env.DB)),
            Effect.provide(artifactStoreLive(env.MEDIA)),
            Effect.provide(generationProviderLive(config)),
            Effect.provide(sessionPublisherLive(env.SESSIONS)),
          ),
        );
        if (result.kind === "failed")
          log("warn", "queue.generation_rejected", {
            messageId: message.id,
            code: result.code,
            retryable: result.retryable,
          });
        message.ack();
      } catch (error) {
        log("error", "queue.generation_failed", {
          messageId: message.id,
          error: String(error),
        });
        message.retry({ delaySeconds: Math.min(60, 2 ** message.attempts) });
      }
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
