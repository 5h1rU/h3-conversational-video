import { Effect, Schema } from "effect";
import {
  anchorForIndex,
  BranchGenerationJob,
  type GroundedAnswerPlan,
  SessionState,
} from "../domain";
import { SPORTS_EPISODE_ID } from "../canonical-sports";
import { compileGenerationPlan } from "../prompt-compiler";
import {
  AnswerPlanLedger,
  AnswerPlanner,
  AnswerPlanningError,
  SessionPublisher,
} from "../services";

export function placementForGroundedAnswer(
  job: BranchGenerationJob,
  answer: GroundedAnswerPlan,
): { readonly branchStartAnchor: string; readonly rejoinAnchor: string } {
  if (job.plan.session.episodeId !== SPORTS_EPISODE_ID) {
    return {
      branchStartAnchor: job.plan.session.branchStartAnchor,
      rejoinAnchor: job.plan.session.rejoinAnchor,
    };
  }
  const currentIndex = Math.max(
    0,
    Math.min(8, Number(job.plan.session.currentAnchor.slice(-3))),
  );
  if (answer.topic === "messi" && currentIndex <= 1) {
    return {
      branchStartAnchor: anchorForIndex(1),
      rejoinAnchor: anchorForIndex(2),
    };
  }
  if (answer.topic === "us-open" && currentIndex <= 2) {
    return {
      branchStartAnchor: anchorForIndex(2),
      rejoinAnchor: anchorForIndex(3),
    };
  }
  return {
    branchStartAnchor: anchorForIndex(currentIndex),
    rejoinAnchor: anchorForIndex(currentIndex + 1),
  };
}

export const groundBranch = Effect.fn("groundBranch")(function* (
  job: BranchGenerationJob,
  at: string,
) {
  const planner = yield* AnswerPlanner;
  const ledger = yield* AnswerPlanLedger;
  const publisher = yield* SessionPublisher;
  const result = yield* planner.plan({
    question: job.plan.session.question,
    episodeId: job.plan.session.episodeId,
    currentAnchor: job.plan.session.currentAnchor,
    requestedAt: at,
  });
  if (!result.plan.canAnswer || result.plan.sources.length === 0) {
    yield* ledger.record({
      generationJobId: job.jobId,
      provider: result.provider,
      model: result.model,
      plan: result.plan,
      gatewayLogId: result.gatewayLogId,
      resolvedPromptCompilerVersion: null,
      desiredOrdinal: null,
      at,
    });
    return yield* new AnswerPlanningError({
      code: "ANSWER_NOT_GROUNDED",
      message: "No sufficiently grounded answer was available",
      retryable: false,
    });
  }
  const placement = placementForGroundedAnswer(job, result.plan);
  const plan = compileGenerationPlan({
    branchId: job.branchId,
    clipId: job.clipId,
    question: job.plan.session.question,
    state: Schema.decodeUnknownSync(SessionState)({
      sessionId: job.sessionId,
      showId: "signal-room",
      episodeId: job.plan.session.episodeId,
      showVersion: "grounded-answer/2",
      stateVersion: job.stateVersion,
      canonicalPlayheadAnchor: job.plan.session.currentAnchor,
      bufferDepthMs: 20_000,
      targetBufferMs: 20_000,
      branchPhase: "planned",
      branchId: job.branchId,
      branchQuestion: job.plan.session.question,
      rejoinAnchor: placement.rejoinAnchor,
      branchArtifactId: null,
      playlistRevision: 1,
      deadlineAt: job.deadlineAt,
    }),
    branchStartAnchor: placement.branchStartAnchor,
    rejoinAnchor: placement.rejoinAnchor,
    continuityBaseUrl: job.plan.continuityStartImageUrl
      ? new URL(job.plan.continuityStartImageUrl.href)
      : new URL("https://invalid.example"),
    groundedAnswer: result.plan,
    currentAnchor: job.plan.session.currentAnchor,
  });
  const desiredOrdinal = Number(placement.branchStartAnchor.slice(-3)) * 10 + 1;
  yield* ledger.record({
    generationJobId: job.jobId,
    provider: result.provider,
    model: result.model,
    plan: result.plan,
    gatewayLogId: result.gatewayLogId,
    resolvedPromptCompilerVersion: "h3-compiler/6",
    desiredOrdinal,
    at,
  });
  yield* publisher.place({
    sessionId: job.sessionId,
    branchId: job.branchId,
    ...placement,
  });
  return new BranchGenerationJob({
    ...job,
    desiredOrdinal,
    plan,
  });
});
