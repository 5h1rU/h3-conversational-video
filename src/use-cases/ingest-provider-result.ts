import { Clock, Effect } from "effect";
import type { FalWebhookPayload } from "../domain";
import type { VerifiedFalWebhook } from "../fal-webhook";
import {
  AuditLedger,
  GenerationProvider,
  ProviderError,
  SessionPublisher,
} from "../services";
import { publishTimeline } from "./publish-timeline";
import { validateCommitArtifact } from "./validate-commit-artifact";

export const ingestProviderResult = Effect.fn("ingestProviderResult")(
  function* (input: {
    readonly webhook: FalWebhookPayload;
    readonly verified: VerifiedFalWebhook;
  }) {
    const audit = yield* AuditLedger;
    const provider = yield* GenerationProvider;
    const publisher = yield* SessionPublisher;
    if (input.webhook.request_id !== input.verified.requestId) {
      return yield* new ProviderError({
        operation: "webhook.correlate",
        code: "FAL_WEBHOOK_REQUEST_MISMATCH",
        message: "Signed request id does not match webhook payload",
        retryable: false,
      });
    }
    const now = yield* Clock.currentTimeMillis;
    const at = new Date(now).toISOString();
    const claimed = yield* audit.claimWebhook(
      input.verified.requestId,
      input.verified.signatureTimestamp,
      at,
    );
    if (!claimed) return { kind: "duplicate" as const };
    const job = yield* audit.findJobByProviderRequest(input.webhook.request_id);
    if (!job) {
      return yield* new ProviderError({
        operation: "webhook.correlate",
        code: "FAL_WEBHOOK_JOB_NOT_FOUND",
        message: "No expected generation matches the provider request",
        retryable: false,
      });
    }
    if (input.webhook.status === "ERROR") {
      yield* audit.markFailed(job.jobId, "FAL_WEBHOOK_ERROR", at);
      yield* publisher.fail(
        job.sessionId,
        job.branchId,
        input.webhook.error ?? "fal generation failed",
      );
      return { kind: "failed" as const };
    }
    const canAccept = yield* publisher.canAccept(job.sessionId, job.branchId);
    if (!canAccept) {
      yield* audit.markFailed(job.jobId, "FAL_RESULT_AFTER_DEADLINE", at);
      return {
        kind: "discarded" as const,
        code: "FAL_RESULT_AFTER_DEADLINE" as const,
      };
    }
    const video = input.webhook.payload?.video;
    if (!video) {
      yield* audit.markFailed(job.jobId, "FAL_WEBHOOK_VIDEO_MISSING", at);
      yield* publisher.fail(
        job.sessionId,
        job.branchId,
        input.webhook.payload_error ??
          "Successful fal webhook did not contain a video",
      );
      return {
        kind: "failed" as const,
        code: "FAL_WEBHOOK_VIDEO_MISSING" as const,
      };
    }
    const candidate = yield* provider.fetchResult({
      url: video.url,
      clipId: job.clipId,
      branchId: job.branchId,
      providerRequestId: input.webhook.request_id,
    });
    const artifact = yield* validateCommitArtifact(candidate);
    const state = yield* publishTimeline({
      sessionId: job.sessionId,
      branchId: job.branchId,
      artifact,
    });
    yield* audit.markCompleted(job.jobId, artifact.artifactId, at);
    return { kind: "completed" as const, artifact, state };
  },
);
