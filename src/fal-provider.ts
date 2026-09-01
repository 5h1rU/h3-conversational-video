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

export const FalH3MaxConversationalBranchProfile = Schema.Struct({
  version: Schema.Literal("h3-max-conversational-branch/3"),
  durationSeconds: Schema.Literal(7),
  resolution: Schema.Literal("480P"),
  promptExpansionMode: Schema.Literal("balanced"),
  aspectRatio: Schema.Literal("16:9"),
  safetyCheckerEnabled: Schema.Literal(true),
  syncModeEnabled: Schema.Literal(false),
});

export const FAL_H3_MAX_CONVERSATIONAL_BRANCH_PROFILE_V3 =
  Schema.decodeUnknownSync(FalH3MaxConversationalBranchProfile)({
    version: "h3-max-conversational-branch/3",
    durationSeconds: 7,
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
  duration: Schema.Literals([5, 7]),
  resolution: Schema.Literal("480P"),
  seed: Schema.Int,
  enable_safety_checker: Schema.Literal(true),
  prompt_expansion_mode: Schema.Literal("balanced"),
  aspect_ratio: Schema.optional(Schema.Literal("16:9")),
  image_url: Schema.optional(Schema.URLFromString),
  end_image_url: Schema.optional(Schema.URLFromString),
}) {}

export const encodeFalH3MaxRequest = Schema.encodeSync(FalH3MaxRequest);

export function compileFalH3MaxRequest(
  plan: GenerationPlan,
): typeof FalH3MaxRequest.Encoded {
  const profile =
    plan.durationSeconds === 7
      ? FAL_H3_MAX_CONVERSATIONAL_BRANCH_PROFILE_V3
      : FAL_H3_MAX_COST_FIRST_PROFILE_V1;
  return encodeFalH3MaxRequest(
    new FalH3MaxRequest({
      prompt: plan.resolvedPrompt,
      duration: plan.durationSeconds,
      resolution: profile.resolution,
      seed: plan.seed,
      enable_safety_checker: profile.safetyCheckerEnabled,
      prompt_expansion_mode: profile.promptExpansionMode,
      ...(plan.continuityStartImageUrl === null
        ? { aspect_ratio: profile.aspectRatio }
        : {
            image_url: plan.continuityStartImageUrl,
            ...(plan.continuityEndImageUrl === null
              ? {}
              : { end_image_url: plan.continuityEndImageUrl }),
          }),
    }),
  );
}
