import { Clock, Effect, Schema } from "effect";
import {
  BRANCH_GENERATION_DEADLINE_MS,
  BranchId,
  ClipId,
  type ViewerEventPayload,
} from "../domain";
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
  publicBaseUrl: string,
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
  const plan = yield* planBranch({
    branchId,
    clipId,
    state,
    event,
    publicBaseUrl,
  });
  const reserved = yield* repository.reserveBranch({
    event,
    branchId,
    clipId,
    jobId,
    idempotencyKey: `viewer-event:${event.eventId}`,
    deadlineAt: now + BRANCH_GENERATION_DEADLINE_MS,
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
