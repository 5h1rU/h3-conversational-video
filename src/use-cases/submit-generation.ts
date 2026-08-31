import { Clock, Effect } from "effect";
import type { BranchGenerationJob } from "../domain";
import { AuditLedger, GenerationProvider, SessionPublisher } from "../services";
import { publishTimeline } from "./publish-timeline";
import { validateCommitArtifact } from "./validate-commit-artifact";

export const submitGeneration = Effect.fn("submitGeneration")(function* (
  job: BranchGenerationJob,
) {
  const audit = yield* AuditLedger;
  const provider = yield* GenerationProvider;
  const publisher = yield* SessionPublisher;
  const now = yield* Clock.currentTimeMillis;
  const at = new Date(now).toISOString();
  const claimed = yield* audit.ensureGeneration(job, "fal", at);
  if (!claimed) return { kind: "duplicate" as const };

  yield* publisher.markGenerating(job.sessionId, job.branchId);
  const submission = yield* provider.submit(job).pipe(
    Effect.tapError((error) =>
      audit
        .markFailed(job.jobId, error.code, at)
        .pipe(
          Effect.andThen(
            publisher.fail(job.sessionId, job.branchId, error.message),
          ),
        ),
    ),
    Effect.catchTag("ProviderError", (error) =>
      error.retryable
        ? Effect.fail(error)
        : Effect.succeed({ kind: "rejected" as const, error }),
    ),
  );
  if (submission.kind === "rejected")
    return {
      kind: "failed" as const,
      code: submission.error.code,
      retryable: false as const,
    };
  yield* audit.markProviderSubmitted(job, submission.providerRequestId, at);
  if (submission.kind === "submitted") return submission;

  const artifact = yield* validateCommitArtifact(submission.artifact).pipe(
    Effect.tapError((error) =>
      audit
        .markFailed(job.jobId, error._tag, at)
        .pipe(
          Effect.andThen(
            publisher.fail(job.sessionId, job.branchId, error.message),
          ),
        ),
    ),
  );
  const state = yield* publishTimeline({
    sessionId: job.sessionId,
    branchId: job.branchId,
    artifact,
  });
  yield* audit.markCompleted(job.jobId, artifact.artifactId, at);
  return { kind: "completed" as const, artifact, state };
});
