import { Clock, Effect, Schema } from "effect";
import { BranchId, ClipId, type ViewerEventPayload } from "../domain";
import {
  GenerationQueue,
  IdGenerator,
  InputError,
  SessionRepository,
} from "../services";
import { planBranch } from "./plan-branch";

const decodeBranchId = Schema.decodeUnknownEffect(BranchId);
const decodeClipId = Schema.decodeUnknownEffect(ClipId);

export const acceptViewerIntent = Effect.fn("acceptViewerIntent")(function* (
  event: ViewerEventPayload,
) {
  const repository = yield* SessionRepository;
  const queue = yield* GenerationQueue;
  const ids = yield* IdGenerator;
  const state = yield* repository.read();
  const branchId = yield* decodeBranchId(`branch-${yield* ids.next}`).pipe(
    Effect.mapError(
      () => new InputError({ message: "Could not create branch id" }),
    ),
  );
  const clipId = yield* decodeClipId(`clip-${yield* ids.next}`).pipe(
    Effect.mapError(
      () => new InputError({ message: "Could not create clip id" }),
    ),
  );
  const jobId = yield* ids.next;
  const now = yield* Clock.currentTimeMillis;
  const plan = yield* planBranch({ branchId, clipId, state, event });
  const reserved = yield* repository.reserveBranch({
    event,
    branchId,
    clipId,
    jobId,
    idempotencyKey: `viewer-event:${event.eventId}`,
    deadlineAt: now + 15_000,
    plan,
  });
  if (reserved.job !== null) {
    yield* queue
      .send(reserved.job)
      .pipe(
        Effect.tapError((error) =>
          repository.failBranch(branchId, error.message),
        ),
      );
  }
  return reserved;
});
