import { Effect } from "effect";
import { ArtifactStore, type ArtifactCommitInput } from "../services";

export const validateCommitArtifact = Effect.fn("validateCommitArtifact")(
  function* (input: ArtifactCommitInput) {
    const artifacts = yield* ArtifactStore;
    return yield* artifacts.validateAndCommit(input);
  },
);
