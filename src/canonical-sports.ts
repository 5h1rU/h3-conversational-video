import { Schema } from "effect";
import {
  BranchId,
  CanonicalBuildPayload,
  ClipId,
  GenerationPlan,
} from "./domain";

export const SPORTS_SHOW_ID = "signal-room-sports";
export const SPORTS_EPISODE_ID = "sports-news-2026-08-31";
export const SPORTS_SHOW_VERSION = "2026-08-31.sports.v1";
export const SPORTS_CONTINUITY_VERSION = "sports-news-continuity/1";

export const SPORTS_VISUAL_BIBLE = {
  anchors:
    "Mara Vale: Latina, late 30s, warm olive skin, shoulder-length dark-brown soft waves, burgundy blazer and ivory blouse. Theo Reyes: Latino, early 40s, medium tan skin, short textured black hair, light stubble, midnight-navy suit, pale-blue shirt, muted burgundy tie.",
  studio:
    "Midnight-blue international sports newsroom, subtle abstract world-map light wall, restrained football and tennis motifs without trademarks, curved dark evidence desk, warm amber practicals.",
  camera:
    "Locked eye-level medium two-shot with a 50mm lens look; Mara frame-left, Theo frame-right; shoulders and hands visible; no cuts, reframing, or camera-axis changes.",
  lighting:
    "Soft 4300K key, gentle fill, amber rim lights, neutral premium broadcast color grade.",
  audio:
    "The same clean studio room tone and the same two voice identities across every clip. Mara has a calm low-mid authoritative delivery; Theo has a warm measured baritone. Natural international-news cadence, no music, no crowd or sports footage audio.",
  blocking:
    "Chronological seated continuity. Each clip begins from the prior endpoint pose and finishes with both anchors composed at the desk, ready for the next line.",
} as const;

export const SPORTS_CANONICAL_SPECS = [
  {
    slot: "messi-headline",
    ordinal: 0,
    clipId: "canonical-sports-messi-headline",
    title: "Messi leaves international football",
    speaker: "Mara Vale and Theo Reyes",
    anchor: "anchor-000",
    dialogue:
      "Mara says, “Lionel Messi is leaving international football.” Theo follows, “A defining era for Argentina is closing.”",
    action:
      "Mara opens directly to camera; Theo turns slightly toward her for the handoff, then returns his gaze to camera.",
  },
  {
    slot: "messi-context",
    ordinal: 10,
    clipId: "canonical-sports-messi-context",
    title: "Two decades and a World Cup legacy",
    speaker: "Mara Vale and Theo Reyes",
    anchor: "anchor-001",
    dialogue:
      "Theo says, “After two decades and a World Cup triumph, his final run seals an extraordinary legacy.” Mara asks, “What stays with you?”",
    action:
      "Theo delivers the context; Mara listens, then naturally opens the conversation to the viewer without breaking the newsroom tone.",
  },
  {
    slot: "us-open-reentry",
    ordinal: 20,
    clipId: "canonical-sports-us-open-reentry",
    title: "Sabalenka opens her US Open defense strongly",
    speaker: "Mara Vale",
    anchor: "anchor-002",
    dialogue:
      "Mara says, “Now to the US Open, where Aryna Sabalenka opened her title defense strongly.”",
    action:
      "Mara starts an independent next headline; neither anchor refers to any viewer question or prior branch.",
  },
  {
    slot: "us-open-continuation",
    ordinal: 30,
    clipId: "canonical-sports-us-open-continuation",
    title: "A rare third consecutive title in view",
    speaker: "Theo Reyes",
    anchor: "anchor-003",
    dialogue:
      "Theo says, “She beat Camila Osorio in straight sets and is chasing a rare third consecutive title.”",
    action:
      "Theo completes the US Open item while Mara listens; finish in a neutral two-shot hold.",
  },
] as const;

export type SportsCanonicalSlot =
  (typeof SPORTS_CANONICAL_SPECS)[number]["slot"];
export const SportsCanonicalSlotSchema = Schema.Literals([
  "messi-headline",
  "messi-context",
  "us-open-reentry",
  "us-open-continuation",
]);

export function sportsCanonicalSpec(slot: SportsCanonicalSlot) {
  const spec = SPORTS_CANONICAL_SPECS.find(
    (candidate) => candidate.slot === slot,
  );
  if (!spec) throw new Error(`Unknown canonical slot: ${slot}`);
  return spec;
}

function deterministicSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function compileCanonicalSportsPlan(
  payload: CanonicalBuildPayload,
): GenerationPlan {
  const spec = sportsCanonicalSpec(payload.slot);
  const branchId = Schema.decodeUnknownSync(BranchId)(
    `canonical-build-${payload.slot}`,
  );
  const clipId = Schema.decodeUnknownSync(ClipId)(spec.clipId);
  const character = {
    primary: "Mara Vale" as const,
    secondary: "Theo Reyes" as const,
    speakingRule:
      "Use only the specified anchor for each quoted line. Preserve the exact fictional faces, wardrobe, voices, cadence, and seated positions from the supplied first frame.",
  };
  const world = {
    show: "The Signal Room" as const,
    set: SPORTS_VISUAL_BIBLE.studio,
    cameraGrammar: SPORTS_VISUAL_BIBLE.camera,
    visualDisclosure:
      "No logos, captions, readable graphics, watermarks, celebrity likenesses, sports footage, or invented cutaways.",
  };
  const session = {
    question: "",
    currentAnchor: spec.anchor,
    rejoinAnchor: spec.anchor,
  };
  const shot = {
    purpose: "canonical-segment" as const,
    dialogue: spec.dialogue,
    framing: `${SPORTS_VISUAL_BIBLE.camera} ${spec.action}`,
    motion:
      "Only natural blinking, breathing, restrained head movement, and one subtle hand gesture. Maintain exact chronological blocking from the input frame.",
    audio: SPORTS_VISUAL_BIBLE.audio,
    terminalState: SPORTS_VISUAL_BIBLE.blocking,
  };
  const resolvedPrompt = [
    `[CHARACTERS] ${SPORTS_VISUAL_BIBLE.anchors} ${character.speakingRule}`,
    `[STUDIO] ${world.set}`,
    `[CAMERA] ${world.cameraGrammar}`,
    `[LIGHTING] ${SPORTS_VISUAL_BIBLE.lighting}`,
    `[AUDIO] ${shot.audio}`,
    `[DIALOGUE] ${shot.dialogue}`,
    `[ACTION] ${shot.framing} ${shot.motion}`,
    `[CONTINUITY] Begin exactly from the supplied image. ${shot.terminalState}`,
    `[TRUTHFULNESS] Use only the quoted sports-news wording. Do not depict Messi, Sabalenka, Osorio, a match, a stadium, highlights, logos, or supporting footage.`,
    "One continuous five-second 16:9 newsroom shot with synchronized speech.",
  ].join("\n");

  return new GenerationPlan({
    compilerVersion: "h3-sports-compiler/1",
    clipId,
    branchId,
    durationSeconds: 5,
    seed: deterministicSeed(`${SPORTS_EPISODE_ID}:${payload.slot}`),
    providerModel: "minimax/h3-max/image-to-video",
    continuityStartImageUrl: payload.continuityStartImageUrl,
    packageBeats: ["canonical"],
    character,
    world,
    session,
    shot,
    resolvedPrompt,
  });
}

export function continuityAssetPath(slot: SportsCanonicalSlot): string {
  const preceding = {
    "messi-headline": "sports-news-visual-bible-v1.png",
    "messi-context": "messi-headline-end.png",
    "us-open-reentry": "messi-context-end.png",
    "us-open-continuation": "us-open-reentry-end.png",
  } as const;
  return `/v1/canonical/assets/${preceding[slot]}`;
}
