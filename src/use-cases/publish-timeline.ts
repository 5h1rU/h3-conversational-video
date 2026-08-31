import { Effect } from "effect";
import type { BranchId, SessionId } from "../domain";
import { SessionPublisher, type CommittedArtifact } from "../services";

export const publishTimeline = Effect.fn("publishTimeline")(function* (input: {
  readonly sessionId: SessionId;
  readonly branchId: BranchId;
  readonly artifact: CommittedArtifact;
}) {
  const publisher = yield* SessionPublisher;
  return yield* publisher.publish(
    input.sessionId,
    input.branchId,
    input.artifact,
  );
});
