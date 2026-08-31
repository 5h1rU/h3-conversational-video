import { Effect, Layer, Predicate, Schema } from "effect";
import {
  anchorForIndex,
  ArtifactId,
  BUFFER_TARGET_MS,
  BranchGenerationJob,
  CanonicalCatalogClip,
  canonicalTimeline,
  CLIP_DURATION_MS,
  type ClipQueueEntry,
  SessionState,
  decodeSessionState as decodeRpcSessionState,
} from "./domain";
import {
  AppConfig,
  ArtifactStore,
  ArtifactValidationError,
  AuditLedger,
  BranchBusy,
  CanonicalCatalog,
  GenerationProvider,
  GenerationQueue,
  IdGenerator,
  type CommittedArtifact,
  ProviderError,
  SessionNotInitialized,
  SessionPublisher,
  SessionRepository,
  StaleGenerationError,
  StorageError,
} from "./services";
import { compileFalH3MaxRequest } from "./fal-provider";
import type { SessionDurableObject } from "./session-do";

const decodeSessionState = Schema.decodeUnknownSync(SessionState);
const decodeArtifactId = Schema.decodeUnknownSync(ArtifactId);

function storageError(operation: string, cause: unknown): StorageError {
  return new StorageError({ operation, message: String(cause) });
}

function readSessionState(ctx: DurableObjectState): SessionState {
  const row = ctx.storage.sql
    .exec<{ state_json: string }>(
      "SELECT state_json FROM session_state WHERE singleton = 1",
    )
    .toArray()[0];
  if (!row)
    throw new SessionNotInitialized({
      message: "Session has not been initialized",
    });
  return decodeSessionState(JSON.parse(row.state_json));
}

function writeSessionState(ctx: DurableObjectState, state: SessionState): void {
  ctx.storage.sql.exec(
    "UPDATE session_state SET state_json = ?, updated_at = ? WHERE singleton = 1",
    JSON.stringify(state),
    Date.now(),
  );
}

export function migrateSessionStorage(ctx: DurableObjectState): void {
  ctx.storage.sql.exec(`
    CREATE TABLE IF NOT EXISTS session_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS canonical_playlist (
      ordinal INTEGER PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK (source = 'canonical'),
      title TEXT NOT NULL,
      speaker TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      media_url TEXT NOT NULL,
      anchor TEXT NOT NULL,
      artifact_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS branch_packages (
      branch_id TEXT PRIMARY KEY,
      package_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function sessionRepositoryLive(
  ctx: DurableObjectState,
): Layer.Layer<SessionRepository> {
  return Layer.succeed(
    SessionRepository,
    SessionRepository.of({
      initialize: (input) =>
        Effect.try({
          try: () =>
            ctx.storage.transactionSync(() => {
              const existing = ctx.storage.sql
                .exec<{ state_json: string }>(
                  "SELECT state_json FROM session_state WHERE singleton = 1",
                )
                .toArray()[0];
              if (existing)
                return decodeSessionState(JSON.parse(existing.state_json));
              const state = decodeSessionState({
                sessionId: input.sessionId,
                showId: input.showId,
                episodeId: input.episodeId,
                showVersion: input.showVersion,
                stateVersion: 1,
                canonicalPlayheadAnchor: anchorForIndex(0),
                bufferDepthMs: BUFFER_TARGET_MS,
                targetBufferMs: BUFFER_TARGET_MS,
                branchPhase: "idle",
                branchId: null,
                branchQuestion: null,
                rejoinAnchor: null,
                branchArtifactId: null,
                playlistRevision: 1,
                deadlineAt: null,
              });
              ctx.storage.sql.exec(
                "INSERT INTO session_state (singleton, state_json, updated_at) VALUES (1, ?, ?)",
                JSON.stringify(state),
                input.now,
              );
              for (const entry of input.canonicalEntries) {
                const artifactId = entry.mediaUrl.split("/media/")[1];
                if (!artifactId)
                  throw new Error(
                    "Canonical entry has no session media artifact",
                  );
                ctx.storage.sql.exec(
                  `INSERT INTO canonical_playlist
                   (ordinal, id, source, title, speaker, duration_ms, media_url, anchor, artifact_id)
                   VALUES (?, ?, 'canonical', ?, ?, ?, ?, ?, ?)`,
                  entry.ordinal,
                  entry.id,
                  entry.title,
                  entry.speaker,
                  entry.durationMs,
                  entry.mediaUrl,
                  entry.anchor,
                  artifactId,
                );
              }
              return state;
            }),
          catch: (cause) => storageError("session.initialize", cause),
        }),
      read: () =>
        Effect.try({
          try: () => readSessionState(ctx),
          catch: (cause) =>
            cause instanceof SessionNotInitialized
              ? cause
              : storageError("session.read", cause),
        }),
      reserveBranch: (input) =>
        Effect.try({
          try: () =>
            ctx.storage.transactionSync(() => {
              const state = readSessionState(ctx);
              const duplicate = ctx.storage.sql
                .exec<{ key: string }>(
                  "SELECT key FROM idempotency_keys WHERE key = ?",
                  input.idempotencyKey,
                )
                .toArray()[0];
              if (duplicate) return { duplicate: true, state, job: null };

              const playbackIndex = Math.min(
                canonicalTimeline().length - 1,
                Math.floor(input.event.playbackPositionMs / CLIP_DURATION_MS),
              );
              const rejoinIndex = Number(
                input.plan.session.rejoinAnchor.slice(-3),
              );
              const branchFinished =
                state.branchPhase === "ready" &&
                state.rejoinAnchor !== null &&
                playbackIndex >= Number(state.rejoinAnchor.slice(-3));
              if (
                !["idle", "failed"].includes(state.branchPhase) &&
                !branchFinished
              ) {
                throw new BranchBusy({
                  branchId: state.branchId ?? "unknown",
                  message: "Only one private interaction branch may be active",
                });
              }

              const nextState = decodeSessionState({
                ...state,
                stateVersion: state.stateVersion + 1,
                canonicalPlayheadAnchor: anchorForIndex(playbackIndex),
                bufferDepthMs: BUFFER_TARGET_MS,
                branchPhase: "planned",
                branchId: input.branchId,
                branchQuestion: input.event.text,
                rejoinAnchor: anchorForIndex(rejoinIndex),
                branchArtifactId: null,
                deadlineAt: input.deadlineAt,
              });
              ctx.storage.sql.exec(
                "INSERT INTO idempotency_keys (key, event_id, created_at) VALUES (?, ?, ?)",
                input.idempotencyKey,
                input.event.eventId,
                Date.now(),
              );
              writeSessionState(ctx, nextState);
              return {
                duplicate: false,
                state: nextState,
                job: new BranchGenerationJob({
                  jobId: input.jobId,
                  idempotencyKey: input.idempotencyKey,
                  sessionId: state.sessionId,
                  branchId: input.branchId,
                  clipId: input.clipId,
                  desiredOrdinal: playbackIndex * 10 + 1,
                  stateVersion: nextState.stateVersion,
                  deadlineAt: input.deadlineAt,
                  plan: input.plan,
                }),
              };
            }),
          catch: (cause) => {
            if (
              cause instanceof BranchBusy ||
              cause instanceof SessionNotInitialized
            )
              return cause;
            return storageError("session.reserveBranch", cause);
          },
        }),
      markGenerating: (branchId) =>
        Effect.try({
          try: () =>
            ctx.storage.transactionSync(() => {
              const state = readSessionState(ctx);
              if (
                state.branchId !== branchId ||
                state.branchPhase !== "planned"
              ) {
                throw new StaleGenerationError({
                  message: "Generation no longer matches active branch",
                });
              }
              const next = decodeSessionState({
                ...state,
                stateVersion: state.stateVersion + 1,
                branchPhase: "generating",
              });
              writeSessionState(ctx, next);
              return next;
            }),
          catch: (cause) =>
            cause instanceof StaleGenerationError
              ? cause
              : storageError("session.markGenerating", cause),
        }),
      publishBranch: (input) =>
        Effect.try({
          try: () =>
            ctx.storage.transactionSync(() => {
              const state = readSessionState(ctx);
              if (
                state.branchId !== input.branchId ||
                !["planned", "generating"].includes(state.branchPhase)
              ) {
                throw new StaleGenerationError({
                  message: "Late result cannot claim the session timeline",
                });
              }
              const next = decodeSessionState({
                ...state,
                stateVersion: state.stateVersion + 1,
                branchPhase: "ready",
                branchArtifactId: input.artifact.artifactId,
                playlistRevision: state.playlistRevision + 1,
                deadlineAt: null,
              });
              ctx.storage.sql.exec(
                `INSERT INTO branch_packages (branch_id, package_json, created_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(branch_id) DO NOTHING`,
                input.branchId,
                JSON.stringify({
                  version: "branch-package/1",
                  entries: [
                    {
                      artifactId: input.artifact.artifactId,
                      beatKinds: ["ingress", "answer", "egress"],
                    },
                  ],
                  rejoinAnchor: state.rejoinAnchor,
                }),
                Date.now(),
              );
              writeSessionState(ctx, next);
              return next;
            }),
          catch: (cause) =>
            cause instanceof StaleGenerationError
              ? cause
              : storageError("session.publishBranch", cause),
        }),
      failBranch: (branchId, reason) =>
        Effect.try({
          try: () =>
            ctx.storage.transactionSync(() => {
              const state = readSessionState(ctx);
              if (state.branchId !== branchId) return state;
              const next = decodeSessionState({
                ...state,
                stateVersion: state.stateVersion + 1,
                branchPhase: "failed",
                deadlineAt: null,
              });
              writeSessionState(ctx, next);
              console.warn(
                JSON.stringify({ event: "branch.failed", branchId, reason }),
              );
              return next;
            }),
          catch: (cause) => storageError("session.failBranch", cause),
        }),
      playlist: () =>
        Effect.try({
          try: () => {
            const state = readSessionState(ctx);
            const storedCanonical = ctx.storage.sql
              .exec<{
                ordinal: number;
                id: string;
                title: string;
                speaker: string;
                duration_ms: number;
                media_url: string;
                anchor: string;
              }>(
                `SELECT ordinal, id, title, speaker, duration_ms, media_url, anchor
                 FROM canonical_playlist ORDER BY ordinal`,
              )
              .toArray();
            const canonical: ClipQueueEntry[] =
              storedCanonical.length > 0
                ? storedCanonical.map((entry) => ({
                    ordinal: entry.ordinal,
                    id: entry.id,
                    source: "canonical",
                    title: entry.title,
                    speaker: entry.speaker,
                    durationMs: entry.duration_ms,
                    mediaUrl: entry.media_url,
                    anchor: entry.anchor,
                    committed: true,
                  }))
                : [...canonicalTimeline()];
            if (
              state.branchPhase !== "ready" ||
              state.branchId === null ||
              state.branchArtifactId === null ||
              state.rejoinAnchor === null
            ) {
              return canonical;
            }
            const currentIndex = Number(
              state.canonicalPlayheadAnchor.slice(-3),
            );
            const rejoinIndex = Number(state.rejoinAnchor.slice(-3));
            const before = canonical.slice(0, currentIndex + 1);
            const after = canonical.slice(rejoinIndex);
            const branch: ClipQueueEntry = {
              ordinal: currentIndex * 10 + 1,
              id: `branch-${state.branchId}`,
              source: "branch",
              title: state.branchQuestion ?? "Viewer question",
              speaker: "Mara Vale",
              durationMs: CLIP_DURATION_MS,
              mediaUrl: `/v1/sessions/${state.sessionId}/media/${state.branchArtifactId}`,
              anchor: state.canonicalPlayheadAnchor,
              committed: true,
            };
            const reentry: ClipQueueEntry = {
              ordinal: currentIndex * 10 + 2,
              id: `reentry-${state.branchId}`,
              source: "reentry",
              title: "Let’s rejoin the signal",
              speaker: "Theo Reyes",
              durationMs: CLIP_DURATION_MS,
              mediaUrl: "/v1/fixtures/reentry.svg",
              anchor: state.rejoinAnchor,
              committed: true,
            };
            const packageRow = ctx.storage.sql
              .exec<{ package_json: string }>(
                "SELECT package_json FROM branch_packages WHERE branch_id = ?",
                state.branchId,
              )
              .toArray()[0];
            return packageRow
              ? [...before, branch, ...after]
              : [...before, branch, reentry, ...after];
          },
          catch: (cause) =>
            cause instanceof SessionNotInitialized
              ? cause
              : storageError("session.playlist", cause),
        }),
      ownsArtifact: (artifactId) =>
        Effect.try({
          try: () => {
            const state = readSessionState(ctx);
            if (state.branchArtifactId === artifactId) return true;
            return Boolean(
              ctx.storage.sql
                .exec<{ artifact_id: string }>(
                  "SELECT artifact_id FROM canonical_playlist WHERE artifact_id = ? LIMIT 1",
                  artifactId,
                )
                .toArray()[0],
            );
          },
          catch: (cause) => storageError("session.ownsArtifact", cause),
        }),
    }),
  );
}

export function generationQueueLive(
  queue: Queue,
): Layer.Layer<GenerationQueue> {
  return Layer.succeed(
    GenerationQueue,
    GenerationQueue.of({
      send: (job) =>
        Effect.tryPromise({
          try: async () => {
            const encoded = Schema.encodeSync(BranchGenerationJob)(job);
            await queue.send(encoded, { contentType: "json" });
          },
          catch: (cause) => storageError("queue.send", cause),
        }),
    }),
  );
}

export function sessionPublisherLive(
  namespace: DurableObjectNamespace<SessionDurableObject>,
): Layer.Layer<SessionPublisher> {
  return Layer.succeed(
    SessionPublisher,
    SessionPublisher.of({
      canAccept: (sessionId, branchId) =>
        Effect.tryPromise({
          try: () => namespace.getByName(sessionId).canAcceptResult(branchId),
          catch: (cause) => storageError("sessionPublisher.canAccept", cause),
        }),
      markGenerating: (sessionId, branchId) =>
        Effect.tryPromise({
          try: async () =>
            decodeRpcSessionState(
              await namespace.getByName(sessionId).markGenerating(branchId),
            ),
          catch: (cause) =>
            storageError("sessionPublisher.markGenerating", cause),
        }),
      publish: (sessionId, branchId, artifact) =>
        Effect.tryPromise({
          try: async () =>
            decodeRpcSessionState(
              await namespace
                .getByName(sessionId)
                .publishBranch(branchId, artifact),
            ),
          catch: (cause) => storageError("sessionPublisher.publish", cause),
        }),
      fail: (sessionId, branchId, reason) =>
        Effect.tryPromise({
          try: async () =>
            decodeRpcSessionState(
              await namespace.getByName(sessionId).failBranch(branchId, reason),
            ),
          catch: (cause) => storageError("sessionPublisher.fail", cause),
        }),
    }),
  );
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function artifactStoreLive(
  bucket: R2Bucket,
): Layer.Layer<ArtifactStore> {
  return Layer.succeed(
    ArtifactStore,
    ArtifactStore.of({
      validateAndCommit: (input) =>
        Effect.tryPromise({
          try: async () => {
            if (input.durationMs !== 5_000 || input.body.byteLength < 64) {
              throw new ArtifactValidationError({
                message: "Artifact failed duration or size validation",
              });
            }
            if (input.contentType === "video/mp4") {
              const marker = new TextDecoder().decode(input.body.slice(4, 8));
              if (marker !== "ftyp")
                throw new ArtifactValidationError({
                  message: "MP4 ftyp signature missing",
                });
            }
            const digestBuffer = await crypto.subtle.digest(
              "SHA-256",
              Uint8Array.from(input.body).buffer,
            );
            const digest = hex(digestBuffer);
            const artifactId = decodeArtifactId(`sha256:${digest}`);
            const extension = input.contentType === "video/mp4" ? "mp4" : "svg";
            const mediaKey = `artifacts/sha256/${digest}/clip.${extension}`;
            const manifestKey = `artifacts/sha256/${digest}/manifest.v1.json`;
            const prior = await bucket.head(mediaKey);
            if (!prior) {
              const stored = await bucket.put(mediaKey, input.body, {
                onlyIf: { etagDoesNotMatch: "*" },
                sha256: digestBuffer,
                httpMetadata: {
                  contentType: input.contentType,
                  cacheControl: "public, max-age=31536000, immutable",
                },
                customMetadata: {
                  artifactId,
                  clipId: input.clipId,
                  branchId: input.branchId,
                  providerRequestId: input.providerRequestId,
                },
              });
              if (!stored)
                throw new Error("Conditional media commit was rejected");
            }
            const committed = await bucket.head(mediaKey);
            if (!committed || committed.size !== input.body.byteLength) {
              throw new ArtifactValidationError({
                message:
                  "Committed R2 object failed read-after-write validation",
              });
            }
            const manifest: CommittedArtifact = {
              artifactId,
              mediaKey,
              manifestKey,
              contentType: input.contentType,
              size: input.body.byteLength,
              durationMs: 5_000,
            };
            if (!(await bucket.head(manifestKey))) {
              await bucket.put(
                manifestKey,
                JSON.stringify({ version: 1, ...manifest }),
                {
                  onlyIf: { etagDoesNotMatch: "*" },
                  httpMetadata: {
                    contentType: "application/json",
                    cacheControl: "public, max-age=31536000, immutable",
                  },
                },
              );
            }
            return manifest;
          },
          catch: (cause) => {
            if (cause instanceof ArtifactValidationError) return cause;
            return storageError("artifact.validateAndCommit", cause);
          },
        }),
    }),
  );
}

function escapeSvg(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function classifyFalSubmissionFailure(status: number): {
  readonly code: string;
  readonly retryable: boolean;
} {
  if (status === 402) return { code: "FAL_PAYMENT_REQUIRED", retryable: false };
  if (status === 401) return { code: "FAL_AUTH_REJECTED", retryable: false };
  if (status === 403) return { code: "FAL_ACCOUNT_REJECTED", retryable: false };
  if (status === 422) return { code: "FAL_INPUT_REJECTED", retryable: false };
  return {
    code: `FAL_HTTP_${status}`,
    retryable:
      status === 408 || status === 425 || status === 429 || status >= 500,
  };
}

export function generationProviderLive(
  config: AppConfig["Service"],
): Layer.Layer<GenerationProvider> {
  return Layer.succeed(
    GenerationProvider,
    GenerationProvider.of({
      submit: (job) =>
        Effect.tryPromise({
          try: async () => {
            if (config.providerMode === "fake") {
              const requestId = `fake-${job.idempotencyKey}`;
              const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#10192b"/><text x="64" y="110" fill="#f6b85f" font-size="28">PRIVATE RESPONSE · GENERATED</text><text x="64" y="270" fill="white" font-size="42">${escapeSvg(job.plan.session.question.slice(0, 70))}</text><text x="64" y="390" fill="#bed1e8" font-size="30">Mara answers, then the program rejoins automatically.</text></svg>`;
              const body = new TextEncoder().encode(svg);
              return {
                kind: "completed" as const,
                providerRequestId: requestId,
                artifact: {
                  clipId: job.clipId,
                  branchId: job.branchId,
                  body,
                  contentType: "image/svg+xml" as const,
                  durationMs: 5_000 as const,
                  providerRequestId: requestId,
                  promptCompilerVersion: job.plan.compilerVersion,
                },
              };
            }
            if (!config.falKey)
              throw new Error("FAL_KEY is required when PROVIDER_MODE=fal");
            const webhookUrl = `${config.publicBaseUrl}/v1/webhooks/fal`;
            const endpoint = `https://queue.fal.run/${job.plan.providerModel}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
            const response = await fetch(endpoint, {
              method: "POST",
              headers: {
                Authorization: `Key ${config.falKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(compileFalH3MaxRequest(job.plan)),
            });
            if (!response.ok) {
              const failure = classifyFalSubmissionFailure(response.status);
              const errorType = response.headers.get("x-fal-error-type");
              throw new ProviderError({
                operation: "provider.submit",
                code: failure.code,
                message: `fal submit rejected with ${response.status}${errorType ? ` (${errorType})` : ""}`,
                retryable: failure.retryable,
              });
            }
            const parsed = Schema.decodeUnknownSync(
              Schema.Struct({ request_id: Schema.NonEmptyString }),
            )(await response.json());
            return {
              kind: "submitted" as const,
              providerRequestId: parsed.request_id,
            };
          },
          catch: (cause) =>
            cause instanceof ProviderError
              ? cause
              : new ProviderError({
                  operation: "provider.submit",
                  code: "FAL_SUBMIT_FAILED",
                  message: String(cause),
                  retryable: true,
                }),
        }),
      fetchResult: (input) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(input.url, { redirect: "manual" });
            if (response.status >= 300 && response.status < 400)
              throw new Error("fal media download redirected unexpectedly");
            if (!response.ok || !response.body)
              throw new Error(
                `fal media download failed with ${response.status}`,
              );
            const contentType = response.headers
              .get("content-type")
              ?.split(";")[0];
            if (contentType !== "video/mp4")
              throw new Error(
                `Unexpected fal media type: ${contentType ?? "missing"}`,
              );
            const declared = Number(
              response.headers.get("content-length") ?? 0,
            );
            if (declared > 32 * 1024 * 1024)
              throw new Error("fal media exceeds 32 MiB prototype limit");
            const reader = response.body.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (true) {
              const result = await reader.read();
              if (result.done) break;
              total += result.value.byteLength;
              if (total > 32 * 1024 * 1024) {
                await reader.cancel("prototype media limit exceeded");
                throw new Error("fal media exceeds 32 MiB prototype limit");
              }
              chunks.push(result.value);
            }
            const body = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              body.set(chunk, offset);
              offset += chunk.byteLength;
            }
            return {
              clipId: input.clipId,
              branchId: input.branchId,
              body,
              contentType: "video/mp4" as const,
              durationMs: 5_000 as const,
              providerRequestId: input.providerRequestId,
              promptCompilerVersion: input.promptCompilerVersion,
            };
          },
          catch: (cause) =>
            new ProviderError({
              operation: "provider.fetchResult",
              code: "FAL_RESULT_DOWNLOAD_FAILED",
              message: String(cause),
              retryable: true,
            }),
        }),
    }),
  );
}

function bindingSecret(env: Env): string | undefined {
  if (!("FAL_KEY" in env)) return undefined;
  const value = env.FAL_KEY;
  return Predicate.isString(value) && value.length > 0 ? value : undefined;
}

export function appConfigLive(env: Env): Layer.Layer<AppConfig> {
  return Layer.succeed(
    AppConfig,
    AppConfig.of({
      environment: env.ENVIRONMENT,
      providerMode: String(env.PROVIDER_MODE) === "fal" ? "fal" : "fake",
      publicBaseUrl: env.PUBLIC_BASE_URL,
      falModel: env.FAL_MODEL,
      falKey: bindingSecret(env),
      canonicalAdminToken:
        "CANONICAL_ADMIN_TOKEN" in env &&
        Predicate.isString(env.CANONICAL_ADMIN_TOKEN) &&
        env.CANONICAL_ADMIN_TOKEN.length > 0
          ? env.CANONICAL_ADMIN_TOKEN
          : undefined,
    }),
  );
}

export const idGeneratorLive = Layer.succeed(
  IdGenerator,
  IdGenerator.of({ next: Effect.sync(() => crypto.randomUUID()) }),
);

export function canonicalCatalogLive(
  db: D1Database,
): Layer.Layer<CanonicalCatalog> {
  return Layer.succeed(
    CanonicalCatalog,
    CanonicalCatalog.of({
      loadPublished: (episodeId) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await db
              .prepare(
                `SELECT ordinal, clip_id, title, speaker, duration_ms, artifact_id, anchor, manifest_key, continuity_contract_version
                 FROM canonical_clips
                 WHERE episode_id = ? AND validation_status = 'APPROVED'
                 ORDER BY ordinal`,
              )
              .bind(episodeId)
              .all<{
                ordinal: number;
                clip_id: string;
                title: string;
                speaker: string;
                duration_ms: number;
                artifact_id: string;
                anchor: string;
                manifest_key: string;
                continuity_contract_version: string;
              }>();
            return Schema.decodeUnknownSync(Schema.Array(CanonicalCatalogClip))(
              rows.results.map((row) => ({
                ordinal: row.ordinal,
                id: row.clip_id,
                title: row.title,
                speaker: row.speaker,
                durationMs: row.duration_ms,
                artifactId: row.artifact_id,
                anchor: row.anchor,
                manifestKey: row.manifest_key,
                continuityContractVersion: row.continuity_contract_version,
              })),
            );
          },
          catch: (cause) => storageError("canonicalCatalog.load", cause),
        }),
    }),
  );
}

export function auditLedgerLive(db: D1Database): Layer.Layer<AuditLedger> {
  const run = <A>(
    operation: string,
    task: () => Promise<A>,
  ): Effect.Effect<A, StorageError> =>
    Effect.tryPromise({
      try: task,
      catch: (cause) => storageError(operation, cause),
    });
  return Layer.succeed(
    AuditLedger,
    AuditLedger.of({
      recordSession: (input) =>
        run("audit.recordSession", async () => {
          await db
            .prepare(
              "INSERT OR IGNORE INTO sessions (id, show_id, episode_id, show_version, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(
              input.sessionId,
              input.showId,
              input.episodeId,
              input.showVersion,
              input.at,
            )
            .run();
        }),
      recordViewerEvent: (input) =>
        run("audit.recordViewerEvent", async () => {
          await db
            .prepare(
              "INSERT OR IGNORE INTO viewer_events (id, session_id, transcript, playback_ms, accepted_at) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(
              input.eventId,
              input.sessionId,
              input.transcript,
              input.playbackMs,
              input.at,
            )
            .run();
        }),
      ensureGeneration: (job, provider, at) =>
        run("audit.ensureGeneration", async () => {
          const result = await db
            .prepare(
              `INSERT OR IGNORE INTO generation_jobs
               (id, idempotency_key, session_id, branch_id, clip_id, desired_ordinal, state_version, status, provider, prompt_compiler_version, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`,
            )
            .bind(
              job.jobId,
              job.idempotencyKey,
              job.sessionId,
              job.branchId,
              job.clipId,
              job.desiredOrdinal,
              job.stateVersion,
              provider,
              job.plan.compilerVersion,
              at,
              at,
            )
            .run();
          return result.meta.changes > 0;
        }),
      markProviderSubmitted: (job, requestId, at) =>
        run("audit.markProviderSubmitted", async () => {
          await db.batch([
            db
              .prepare(
                "UPDATE generation_jobs SET status = 'SUBMITTED', provider_request_id = ?, updated_at = ? WHERE id = ?",
              )
              .bind(requestId, at, job.jobId),
            db
              .prepare(
                "INSERT INTO provider_attempts (id, generation_job_id, provider, endpoint, request_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?)",
              )
              .bind(
                crypto.randomUUID(),
                job.jobId,
                "fal",
                job.plan.compilerVersion,
                requestId,
                at,
              ),
          ]);
        }),
      findJobByProviderRequest: (requestId) =>
        run("audit.findJobByProviderRequest", async () => {
          const row = await db
            .prepare(
              "SELECT id, session_id, branch_id, clip_id, state_version, prompt_compiler_version FROM generation_jobs WHERE provider_request_id = ?",
            )
            .bind(requestId)
            .first<{
              id: string;
              session_id: string;
              branch_id: string;
              clip_id: string;
              state_version: number;
              prompt_compiler_version: "h3-compiler/1" | "h3-sports-compiler/1";
            }>();
          if (!row) return null;
          return Schema.decodeUnknownSync(
            Schema.Struct({
              jobId: Schema.String,
              sessionId: Schema.NonEmptyString.pipe(Schema.brand("SessionId")),
              branchId: Schema.NonEmptyString.pipe(Schema.brand("BranchId")),
              clipId: Schema.NonEmptyString.pipe(Schema.brand("ClipId")),
              stateVersion: Schema.Int.pipe(Schema.brand("StateVersion")),
              promptCompilerVersion: Schema.Literals([
                "h3-compiler/1",
                "h3-sports-compiler/1",
              ]),
            }),
          )({
            jobId: row.id,
            sessionId: row.session_id,
            branchId: row.branch_id,
            clipId: row.clip_id,
            stateVersion: row.state_version,
            promptCompilerVersion: row.prompt_compiler_version,
          });
        }),
      markCompleted: (jobId, artifactId, at) =>
        run("audit.markCompleted", async () => {
          await db
            .prepare(
              "UPDATE generation_jobs SET status = 'COMPLETED', artifact_id = ?, updated_at = ? WHERE id = ?",
            )
            .bind(artifactId, at, jobId)
            .run();
        }),
      markFailed: (jobId, code, at) =>
        run("audit.markFailed", async () => {
          await db
            .prepare(
              "UPDATE generation_jobs SET status = 'FAILED', error_code = ?, updated_at = ? WHERE id = ?",
            )
            .bind(code, at, jobId)
            .run();
        }),
      claimWebhook: (requestId, signatureTimestamp, at) =>
        run("audit.claimWebhook", async () => {
          const result = await db
            .prepare(
              `INSERT INTO webhook_deliveries (request_id, signature_timestamp, status, received_at)
               VALUES (?, ?, 'PROCESSING', ?)
               ON CONFLICT(request_id) DO UPDATE SET
                 signature_timestamp = excluded.signature_timestamp,
                 status = 'PROCESSING',
                 received_at = excluded.received_at
               WHERE webhook_deliveries.status IN ('RETRYABLE', 'VERIFIED')
                  OR (
                    webhook_deliveries.status = 'PROCESSING'
                    AND unixepoch(webhook_deliveries.received_at) <= unixepoch(excluded.received_at) - 120
                  )`,
            )
            .bind(requestId, signatureTimestamp, at)
            .run();
          return result.meta.changes > 0;
        }),
      settleWebhook: (requestId, status, at) =>
        run("audit.settleWebhook", async () => {
          await db
            .prepare(
              `UPDATE webhook_deliveries
               SET status = ?, received_at = ?
               WHERE request_id = ? AND status = 'PROCESSING'`,
            )
            .bind(status, at, requestId)
            .run();
        }),
    }),
  );
}
