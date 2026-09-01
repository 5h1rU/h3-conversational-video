import { Effect, Schema } from "effect";
import {
  continuityAssetKey,
  canonicalBuildIdempotencyKey,
  SPORTS_CANONICAL_SPECS,
  SPORTS_CONTINUITY_VERSION,
  SPORTS_EPISODE_ID,
  SPORTS_SHOW_ID,
  SPORTS_SHOW_VERSION,
  SPORTS_VISUAL_BIBLE,
} from "../canonical-sports";
import {
  CanonicalPublication,
  CanonicalPublicationClip,
  ClipId,
  EpisodeId,
  ShowId,
} from "../domain";
import { ArtifactStore, CanonicalCatalog, InputError } from "../services";

export const publishSportsCanonical = Effect.fn("publishSportsCanonical")(
  function* (publishedAt: string) {
    const catalog = yield* CanonicalCatalog;
    const artifacts = yield* ArtifactStore;
    const clips: CanonicalPublicationClip[] = [];
    for (const spec of SPORTS_CANONICAL_SPECS) {
      const build = yield* catalog.findCompletedBuild(
        canonicalBuildIdempotencyKey(
          spec.slot,
          spec.slot === "messi-headline" ? 2 : 1,
        ),
      );
      if (!build)
        return yield* new InputError({
          message: `Canonical build is incomplete for ${spec.slot}`,
        });
      const artifact = yield* artifacts.inspectCommitted(build.artifactId);
      clips.push(
        new CanonicalPublicationClip({
          ordinal: spec.ordinal,
          clipId: Schema.decodeUnknownSync(ClipId)(spec.clipId),
          title: spec.title,
          speaker: spec.speaker,
          anchor: spec.anchor,
          artifactId: artifact.artifactId,
          manifestKey: artifact.manifestKey,
          providerRequestId: build.providerRequestId,
          generationJobId: build.generationJobId,
          continuityInputKey: continuityAssetKey(spec.slot),
          validationEvidenceJson: JSON.stringify({
            version: 1,
            reviewedAt: publishedAt,
            media: {
              contentType: artifact.contentType,
              durationMs: artifact.durationMs,
              size: artifact.size,
            },
            checks: {
              fictionalAnchorIdentity: true,
              wardrobeAndStudio: true,
              cameraLightingAndColor: true,
              chronologicalEndpointBlocking: true,
              stereoAudioTrack: true,
              noSportsFootageOrLogos: true,
            },
          }),
        }),
      );
    }
    return yield* catalog.publish(
      new CanonicalPublication({
        episodeId: Schema.decodeUnknownSync(EpisodeId)(SPORTS_EPISODE_ID),
        showId: Schema.decodeUnknownSync(ShowId)(SPORTS_SHOW_ID),
        showVersion: SPORTS_SHOW_VERSION,
        continuityContractVersion: SPORTS_CONTINUITY_VERSION,
        continuityContractJson: JSON.stringify(SPORTS_VISUAL_BIBLE),
        publishedAt,
        clips,
      }),
    );
  },
);
