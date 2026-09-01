import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  BranchGenerationJob,
  BranchId,
  ClipId,
  GroundedAnswerPlan,
  GroundingSource,
  SessionId,
  SessionState,
  StateVersion,
} from "../src/domain";
import { SPORTS_EPISODE_ID } from "../src/canonical-sports";
import { compileGenerationPlan } from "../src/prompt-compiler";
import {
  AnswerPlanLedger,
  AnswerPlanner,
  SessionPublisher,
} from "../src/services";
import {
  groundBranch,
  placementForGroundedAnswer,
} from "../src/use-cases/ground-branch";

function fixture() {
  const branchId = Schema.decodeUnknownSync(BranchId)("branch-grounded");
  const clipId = Schema.decodeUnknownSync(ClipId)("clip-grounded");
  const state = Schema.decodeUnknownSync(SessionState)({
    sessionId: "session-grounded",
    showId: "signal-room-sports",
    episodeId: SPORTS_EPISODE_ID,
    showVersion: "sports-v1",
    stateVersion: 1,
    canonicalPlayheadAnchor: "anchor-001",
    bufferDepthMs: 20_000,
    targetBufferMs: 20_000,
    branchPhase: "planned",
    branchId,
    branchQuestion: "What was the U.S. Open score?",
    rejoinAnchor: "anchor-002",
    branchArtifactId: null,
    playlistRevision: 1,
    deadlineAt: 9_999_999_999_999,
  });
  const answer = new GroundedAnswerPlan({
    plannerVersion: "grounded-answer/1",
    canAnswer: true,
    topic: "us-open",
    confidence: "high",
    answer: "Sabalenka won in straight sets, six-three, six-two.",
    ingress: "A viewer is asking for the exact U.S. Open score.",
    egress: "That result sets up the next part of her title defense.",
    informationAsOf: "2026-08-31T20:00:00.000Z",
    sources: [
      new GroundingSource({
        title: "Official match report",
        url: new URL("https://www.usopen.org/result"),
        publishedAt: "2026-08-31",
      }),
    ],
  });
  const job = new BranchGenerationJob({
    jobId: "job-grounded",
    idempotencyKey: "viewer-event:grounded",
    sessionId: Schema.decodeUnknownSync(SessionId)("session-grounded"),
    branchId,
    clipId,
    desiredOrdinal: 11,
    stateVersion: Schema.decodeUnknownSync(StateVersion)(2),
    deadlineAt: 9_999_999_999_999,
    plan: compileGenerationPlan({
      branchId,
      clipId,
      question: "What was the U.S. Open score?",
      state,
      branchStartAnchor: "anchor-001",
      rejoinAnchor: "anchor-002",
      continuityBaseUrl: new URL("https://prototype.example"),
      currentAnchor: "anchor-001",
    }),
  });
  return { answer, job, state };
}

describe("grounded branch planning", () => {
  it("places a U.S. Open answer after its intro and before its continuation", () => {
    const { answer, job } = fixture();
    expect(placementForGroundedAnswer(job, answer)).toEqual({
      branchStartAnchor: "anchor-002",
      rejoinAnchor: "anchor-003",
    });
  });

  it("compiles exact grounded dialogue before changing Session DO placement", async () => {
    const { answer, job, state } = fixture();
    const recorded: string[] = [];
    const result = await Effect.runPromise(
      groundBranch(job, "2026-08-31T20:00:00.000Z").pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(
              AnswerPlanner,
              AnswerPlanner.of({
                plan: () =>
                  Effect.succeed({
                    provider: "fake" as const,
                    model: "fake-grounding/1",
                    gatewayLogId: "gateway-log-1",
                    plan: answer,
                  }),
              }),
            ),
            Layer.succeed(
              AnswerPlanLedger,
              AnswerPlanLedger.of({
                record: (input) =>
                  Effect.sync(() => {
                    recorded.push(
                      `ledger:${input.resolvedPromptCompilerVersion}:${input.desiredOrdinal}`,
                    );
                  }),
              }),
            ),
            Layer.succeed(
              SessionPublisher,
              SessionPublisher.of({
                canAccept: () => Effect.succeed(true),
                markGenerating: () => Effect.succeed(state),
                place: (input) =>
                  Effect.sync(() => {
                    recorded.push(
                      `place:${input.branchStartAnchor}:${input.rejoinAnchor}`,
                    );
                    return state;
                  }),
                publish: () => Effect.succeed(state),
                fail: () => Effect.succeed(state),
              }),
            ),
          ),
        ),
      ),
    );
    expect(result.plan.compilerVersion).toBe("h3-compiler/4");
    expect(result.plan.grounding?.answer).toBe(answer.answer);
    expect(result.plan.resolvedPrompt).toContain(answer.ingress);
    expect(result.plan.resolvedPrompt).toContain(answer.answer);
    expect(result.plan.resolvedPrompt).toContain(answer.egress);
    expect(result.desiredOrdinal).toBe(21);
    expect(result.plan.continuityStartImageUrl?.pathname).toBe(
      "/v1/canonical/assets/us-open-reentry-end.png",
    );
    expect(result.plan.continuityEndImageUrl).toEqual(
      result.plan.continuityStartImageUrl,
    );
    expect(recorded).toEqual([
      "ledger:h3-compiler/4:21",
      "place:anchor-002:anchor-003",
    ]);
  });
});
