import { describe, expect, it } from "vitest";
import {
  compileCanonicalSportsPlan,
  SPORTS_CANONICAL_SPECS,
  SPORTS_CONTINUITY_VERSION,
  SPORTS_EPISODE_ID,
} from "../src/canonical-sports";
import { CanonicalBuildPayload } from "../src/domain";
import { compileFalH3MaxRequest } from "../src/fal-provider";

describe("sports canonical release", () => {
  it("defines exactly four truthful ordered five-second segments", () => {
    expect(SPORTS_CANONICAL_SPECS.map((clip) => clip.slot)).toEqual([
      "messi-headline",
      "messi-context",
      "us-open-reentry",
      "us-open-continuation",
    ]);
    expect(SPORTS_CANONICAL_SPECS.map((clip) => clip.ordinal)).toEqual([
      0, 10, 20, 30,
    ]);
    const dialogue = SPORTS_CANONICAL_SPECS.map((clip) => clip.dialogue).join(
      " ",
    );
    expect(dialogue).toContain("Lionel Messi");
    expect(dialogue).toContain("World Cup triumph");
    expect(dialogue).toContain("Aryna Sabalenka");
    expect(dialogue).toContain("Camila Osorio");
    expect(dialogue).toContain("third consecutive title");
    expect(SPORTS_EPISODE_ID).toBe("sports-news-2026-08-31");
    expect(SPORTS_CONTINUITY_VERSION).toBe("sports-news-continuity/1");
  });

  it("resolves every canonical request to the supported image continuity contract", () => {
    for (const spec of SPORTS_CANONICAL_SPECS) {
      const imageUrl = new URL(
        `https://prototype.example/continuity/${spec.slot}.png`,
      );
      const plan = compileCanonicalSportsPlan(
        new CanonicalBuildPayload({
          slot: spec.slot,
          attempt: 1,
          continuityStartImageUrl: imageUrl,
        }),
      );
      const request = compileFalH3MaxRequest(plan);
      expect(plan.providerModel).toBe("minimax/h3-max/image-to-video");
      expect(plan.packageBeats).toEqual(["canonical"]);
      expect(request).toMatchObject({
        duration: 5,
        resolution: "480P",
        prompt_expansion_mode: "balanced",
        enable_safety_checker: true,
        image_url: imageUrl.toString(),
      });
      expect(request).not.toHaveProperty("aspect_ratio");
      expect(request).not.toHaveProperty("sync_mode");
    }
  });
});
