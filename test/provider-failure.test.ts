import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BranchGenerationJob,
  BranchId,
  ClipId,
  SessionId,
  SessionState,
  StateVersion,
} from "../src/domain";
import { classifyFalSubmissionFailure } from "../src/layers";
import { compileGenerationPlan } from "../src/prompt-compiler";
import {
  ArtifactStore,
  AuditLedger,
  GenerationProvider,
  ProviderError,
  SessionPublisher,
} from "../src/services";
import { submitGeneration } from "../src/use-cases/submit-generation";

function generationFixture(): {
  readonly job: BranchGenerationJob;
  readonly state: typeof SessionState.Type;
} {
  const branchId = Schema.decodeUnknownSync(BranchId)("branch-no-credit");
  const clipId = Schema.decodeUnknownSync(ClipId)("clip-no-credit");
  const state = Schema.decodeUnknownSync(SessionState)({
    sessionId: "session-no-credit",
    showId: "signal-room",
    episodeId: "episode-001",
    showVersion: "v1",
    stateVersion: 1,
    canonicalPlayheadAnchor: "anchor-001",
    bufferDepthMs: 20_000,
    targetBufferMs: 20_000,
    branchPhase: "planned",
    branchId,
    branchQuestion: "Question",
    rejoinAnchor: "anchor-005",
    branchArtifactId: null,
    playlistRevision: 1,
    deadlineAt: 9_999_999_999_999,
  });
  const job = new BranchGenerationJob({
    jobId: "job-no-credit",
    idempotencyKey: "queue-no-credit",
    sessionId: Schema.decodeUnknownSync(SessionId)("session-no-credit"),
    branchId,
    clipId,
    desiredOrdinal: 11,
    stateVersion: Schema.decodeUnknownSync(StateVersion)(2),
    deadlineAt: 9_999_999_999_999,
    plan: compileGenerationPlan({
      branchId,
      clipId,
      question: "Question",
      state,
      rejoinAnchor: "anchor-005",
    }),
  });
  return { job, state };
}

describe("fal submission failure policy", () => {
  it("classifies payment and account rejection as terminal", () => {
    expect(classifyFalSubmissionFailure(402)).toEqual({
      code: "FAL_PAYMENT_REQUIRED",
      retryable: false,
    });
    expect(classifyFalSubmissionFailure(403)).toEqual({
      code: "FAL_ACCOUNT_REJECTED",
      retryable: false,
    });
    expect(classifyFalSubmissionFailure(503).retryable).toBe(true);
  });

  it("records fallback and resolves a terminal provider rejection for queue acknowledgement", async () => {
    const recorded: string[] = [];
    const { job, state } = generationFixture();
    const layers = Layer.mergeAll(
      Layer.succeed(
        GenerationProvider,
        GenerationProvider.of({
          submit: () =>
            Effect.fail(
              new ProviderError({
                operation: "provider.submit",
                code: "FAL_PAYMENT_REQUIRED",
                message: "fal submit rejected with 402",
                retryable: false,
              }),
            ),
          fetchResult: () =>
            Effect.fail(
              new ProviderError({
                operation: "provider.fetchResult",
                code: "UNUSED",
                message: "unused",
                retryable: false,
              }),
            ),
        }),
      ),
      Layer.succeed(
        AuditLedger,
        AuditLedger.of({
          recordSession: () => Effect.void,
          recordViewerEvent: () => Effect.void,
          ensureGeneration: () => Effect.succeed(true),
          markProviderSubmitted: () => Effect.void,
          findJobByProviderRequest: () => Effect.succeed(null),
          markCompleted: () => Effect.void,
          markFailed: (_jobId, code) =>
            Effect.sync(() => {
              recorded.push(`audit:${code}`);
            }),
          claimWebhook: () => Effect.succeed(true),
          settleWebhook: () => Effect.void,
        }),
      ),
      Layer.succeed(
        SessionPublisher,
        SessionPublisher.of({
          canAccept: () => Effect.succeed(true),
          markGenerating: () => Effect.succeed(state),
          publish: () => Effect.succeed(state),
          fail: () =>
            Effect.sync(() => {
              recorded.push("session:failed");
              return state;
            }),
        }),
      ),
      Layer.succeed(
        ArtifactStore,
        ArtifactStore.of({
          inspectCommitted: () => Effect.die("unused"),
          validateAndCommit: () =>
            Effect.die("artifact commit must not run after provider rejection"),
        }),
      ),
    );

    const result = await Effect.runPromise(
      submitGeneration(job).pipe(Effect.provide(layers)),
    );
    expect(result).toEqual({
      kind: "failed",
      code: "FAL_PAYMENT_REQUIRED",
      retryable: false,
    });
    expect(recorded).toEqual(["audit:FAL_PAYMENT_REQUIRED", "session:failed"]);
  });
});
