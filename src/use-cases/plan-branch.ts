import { Effect } from "effect";
import {
  anchorForIndex,
  CLIP_DURATION_MS,
  type BranchId,
  type ClipId,
  type SessionState,
  type ViewerEventPayload,
} from "../domain";
import { compileGenerationPlan } from "../prompt-compiler";
import { SPORTS_EPISODE_ID } from "../canonical-sports";

export const planBranch = Effect.fn("planBranch")(
  (input: {
    readonly branchId: BranchId;
    readonly clipId: ClipId;
    readonly state: SessionState;
    readonly event: ViewerEventPayload;
    readonly publicBaseUrl: string;
  }) =>
    Effect.sync(() => {
      const playbackIndex = Math.floor(
        input.event.playbackPositionMs / CLIP_DURATION_MS,
      );
      const isSportsEpisode = input.state.episodeId === SPORTS_EPISODE_ID;
      const sportsPlaybackIndex = Math.max(0, Math.min(8, playbackIndex));
      const sportsStartIndex = Math.max(1, sportsPlaybackIndex);
      const branchStartAnchor = isSportsEpisode
        ? anchorForIndex(sportsStartIndex)
        : anchorForIndex(playbackIndex);
      const rejoinAnchor = isSportsEpisode
        ? anchorForIndex(sportsStartIndex + 1)
        : anchorForIndex(Math.min(143, playbackIndex + 4));
      return compileGenerationPlan({
        branchId: input.branchId,
        clipId: input.clipId,
        question: input.event.text,
        state: input.state,
        branchStartAnchor,
        rejoinAnchor,
        continuityBaseUrl: new URL(input.publicBaseUrl),
        currentAnchor: anchorForIndex(playbackIndex),
      });
    }),
);
