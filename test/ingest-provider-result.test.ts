import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ArtifactId,
  BranchId,
  ClipId,
  SessionId,
  SessionState,
  StateVersion,
} from "../src/domain";
import { decodeFalWebhookBody } from "../src/fal-webhook";
import {
  ArtifactStore,
  AuditLedger,
  GenerationProvider,
  ProviderError,
  SessionPublisher,
} from "../src/services";
import { ingestProviderResult } from "../src/use-cases/ingest-provider-result";

const sessionId = Schema.decodeUnknownSync(SessionId)("session-webhook");
const branchId = Schema.decodeUnknownSync(BranchId)("branch-webhook");
const clipId = Schema.decodeUnknownSync(ClipId)("clip-webhook");
const artifactId = Schema.decodeUnknownSync(ArtifactId)(
  `sha256:${"b".repeat(64)}`,
);
const state = Schema.decodeUnknownSync(SessionState)({
  sessionId,
  showId: "signal-room",
  episodeId: "episode-001",
  showVersion: "v1",
  stateVersion: 4,
  canonicalPlayheadAnchor: "anchor-001",
  bufferDepthMs: 20_000,
  targetBufferMs: 20_000,
  branchPhase: "ready",
  branchId,
  branchQuestion: "Question",
  rejoinAnchor: "anchor-005",
  branchArtifactId: artifactId,
  playlistRevision: 2,
  deadlineAt: null,
});
const committed = {
  artifactId,
  mediaKey: `artifacts/sha256/${"b".repeat(64)}/clip.mp4`,
  manifestKey: `artifacts/sha256/${"b".repeat(64)}/manifest.v1.json`,
  contentType: "video/mp4",
  size: 128,
  durationMs: 5_000 as const,
};

async function decodedWebhook() {
  return Effect.runPromise(
    decodeFalWebhookBody(
      new TextEncoder().encode(
        JSON.stringify({
          request_id: "provider-request-1",
          gateway_request_id: "provider-request-1",
          status: "OK",
          payload: {
            video: {
              url: "https://v3b.fal.media/files/example/generated.mp4",
              content_type: "video/mp4",
              file_name: "generated.mp4",
              file_size: 128,
            },
            expanded_prompt: "Expanded prompt",
          },
        }),
      ),
    ),
  );
}

function auditLayer(recorded: string[]): Layer.Layer<AuditLedger> {
  return Layer.succeed(
    AuditLedger,
    AuditLedger.of({
      recordSession: () => Effect.void,
      recordViewerEvent: () => Effect.void,
      ensureGeneration: () => Effect.succeed(true),
      markProviderSubmitted: () => Effect.void,
      findJobByProviderRequest: () =>
        Effect.succeed({
          jobId: "job-webhook",
          sessionId,
          branchId,
          clipId,
          stateVersion: Schema.decodeUnknownSync(StateVersion)(3),
          promptCompilerVersion: "h3-compiler/1" as const,
          durationMs: 5_000 as const,
        }),
      markCompleted: () =>
        Effect.sync(() => {
          recorded.push("d1:completed");
        }),
      markFailed: (_jobId, code) =>
        Effect.sync(() => {
          recorded.push(`d1:failed:${code}`);
        }),
      claimWebhook: () =>
        Effect.sync(() => {
          recorded.push("d1:claimed");
          return true;
        }),
      settleWebhook: (_requestId, status) =>
        Effect.sync(() => {
          recorded.push(`d1:webhook:${status.toLowerCase()}`);
        }),
    }),
  );
}

describe("provider result ingestion", () => {
  it("claims, fetches, commits, and publishes a realistic fal result", async () => {
    const recorded: string[] = [];
    const layers = Layer.mergeAll(
      auditLayer(recorded),
      Layer.succeed(
        GenerationProvider,
        GenerationProvider.of({
          submit: () => Effect.die("unused"),
          fetchResult: (input) =>
            Effect.sync(() => {
              expect(input.url).toBeInstanceOf(URL);
              expect(input.url.protocol).toBe("https:");
              recorded.push("provider:fetched");
              return {
                clipId,
                branchId,
                body: new Uint8Array(128),
                contentType: "video/mp4" as const,
                durationMs: 5_000 as const,
                providerRequestId: "provider-request-1",
                promptCompilerVersion: "h3-compiler/1" as const,
              };
            }),
        }),
      ),
      Layer.succeed(
        ArtifactStore,
        ArtifactStore.of({
          inspectCommitted: () => Effect.die("unused"),
          validateAndCommit: () =>
            Effect.sync(() => {
              recorded.push("r2:committed");
              return committed;
            }),
        }),
      ),
      Layer.succeed(
        SessionPublisher,
        SessionPublisher.of({
          canAccept: () => Effect.succeed(true),
          markGenerating: () => Effect.succeed(state),
          publish: () =>
            Effect.sync(() => {
              recorded.push("session:published");
              return state;
            }),
          fail: () => Effect.succeed(state),
        }),
      ),
    );

    const result = await Effect.runPromise(
      ingestProviderResult({
        webhook: await decodedWebhook(),
        verified: {
          requestId: "provider-request-1",
          signatureTimestamp: 1_788_200_000,
        },
      }).pipe(Effect.provide(layers)),
    );

    expect(result.kind).toBe("completed");
    expect(recorded).toEqual([
      "d1:claimed",
      "provider:fetched",
      "r2:committed",
      "session:published",
      "d1:completed",
      "d1:webhook:completed",
    ]);
  });

  it("acknowledges a late result without fetching, committing, or publishing it", async () => {
    const recorded: string[] = [];
    const layers = Layer.mergeAll(
      auditLayer(recorded),
      Layer.succeed(
        GenerationProvider,
        GenerationProvider.of({
          submit: () => Effect.die("unused"),
          fetchResult: () => Effect.die("late result must not be fetched"),
        }),
      ),
      Layer.succeed(
        ArtifactStore,
        ArtifactStore.of({
          inspectCommitted: () => Effect.die("unused"),
          validateAndCommit: () => Effect.die("late result must not commit"),
        }),
      ),
      Layer.succeed(
        SessionPublisher,
        SessionPublisher.of({
          canAccept: () => Effect.succeed(false),
          markGenerating: () => Effect.succeed(state),
          publish: () => Effect.die("late result must not publish"),
          fail: () => Effect.succeed(state),
        }),
      ),
    );

    const result = await Effect.runPromise(
      ingestProviderResult({
        webhook: await decodedWebhook(),
        verified: {
          requestId: "provider-request-1",
          signatureTimestamp: 1_788_200_000,
        },
      }).pipe(Effect.provide(layers)),
    );

    expect(result).toEqual({
      kind: "discarded",
      code: "FAL_RESULT_AFTER_DEADLINE",
    });
    expect(recorded).toEqual([
      "d1:claimed",
      "d1:failed:FAL_RESULT_AFTER_DEADLINE",
      "d1:webhook:completed",
    ]);
  });

  it("releases a claimed delivery for retry after a transient media failure", async () => {
    const recorded: string[] = [];
    const layers = Layer.mergeAll(
      auditLayer(recorded),
      Layer.succeed(
        GenerationProvider,
        GenerationProvider.of({
          submit: () => Effect.die("unused"),
          fetchResult: () =>
            Effect.fail(
              new ProviderError({
                operation: "provider.fetchResult",
                code: "FAL_RESULT_DOWNLOAD_FAILED",
                message: "temporary media fetch failure",
                retryable: true,
              }),
            ),
        }),
      ),
      Layer.succeed(
        ArtifactStore,
        ArtifactStore.of({
          inspectCommitted: () => Effect.die("unused"),
          validateAndCommit: () => Effect.die("failed media must not commit"),
        }),
      ),
      Layer.succeed(
        SessionPublisher,
        SessionPublisher.of({
          canAccept: () => Effect.succeed(true),
          markGenerating: () => Effect.succeed(state),
          publish: () => Effect.die("failed media must not publish"),
          fail: () => Effect.succeed(state),
        }),
      ),
    );

    await expect(
      Effect.runPromise(
        ingestProviderResult({
          webhook: await decodedWebhook(),
          verified: {
            requestId: "provider-request-1",
            signatureTimestamp: 1_788_200_000,
          },
        }).pipe(Effect.provide(layers)),
      ),
    ).rejects.toThrow("temporary media fetch failure");
    expect(recorded).toEqual(["d1:claimed", "d1:webhook:retryable"]);
  });
});
