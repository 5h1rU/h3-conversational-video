import { Schema } from "effect";
import type { GenerationPlan } from "./domain";

export const FalH3MaxGenerationProfile = Schema.Struct({
  version: Schema.Literal("h3-max-cost-first/1"),
  durationSeconds: Schema.Literal(5),
  resolution: Schema.Literal("480P"),
  promptExpansionMode: Schema.Literal("balanced"),
  aspectRatio: Schema.Literal("16:9"),
  safetyCheckerEnabled: Schema.Literal(true),
  syncModeEnabled: Schema.Literal(false),
});
export type FalH3MaxGenerationProfile = typeof FalH3MaxGenerationProfile.Type;

export const FAL_H3_MAX_COST_FIRST_PROFILE_V1 = Schema.decodeUnknownSync(
  FalH3MaxGenerationProfile,
)({
  version: "h3-max-cost-first/1",
  durationSeconds: 5,
  resolution: "480P",
  promptExpansionMode: "balanced",
  aspectRatio: "16:9",
  safetyCheckerEnabled: true,
  syncModeEnabled: false,
});

export class FalH3MaxRequest extends Schema.Class<FalH3MaxRequest>(
  "h3/FalH3MaxRequest",
)({
  prompt: Schema.String,
  duration: Schema.Literal(5),
  resolution: Schema.Literal("480P"),
  seed: Schema.Int,
  enable_safety_checker: Schema.Literal(true),
  prompt_expansion_mode: Schema.Literal("balanced"),
  aspect_ratio: Schema.Literal("16:9"),
}) {}

export const encodeFalH3MaxRequest = Schema.encodeSync(FalH3MaxRequest);

export function compileFalH3MaxRequest(
  plan: GenerationPlan,
): typeof FalH3MaxRequest.Encoded {
  const profile = FAL_H3_MAX_COST_FIRST_PROFILE_V1;
  return encodeFalH3MaxRequest(
    new FalH3MaxRequest({
      prompt: plan.resolvedPrompt,
      duration: profile.durationSeconds,
      resolution: profile.resolution,
      seed: plan.seed,
      enable_safety_checker: profile.safetyCheckerEnabled,
      prompt_expansion_mode: profile.promptExpansionMode,
      aspect_ratio: profile.aspectRatio,
    }),
  );
}
