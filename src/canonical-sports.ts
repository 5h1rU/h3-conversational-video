import { Schema } from "effect";
import {
  BranchId,
  CanonicalBuildPayload,
  ClipId,
  GenerationPlan,
} from "./domain";

export const SPORTS_SHOW_ID = "signal-room-sports";
export const SPORTS_EPISODE_ID = "sports-news-2026-08-31";
export const SPORTS_SHOW_VERSION = "2026-08-31.sports.v2";
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
  {
    slot: "djokovic-upset-headline",
    ordinal: 40,
    clipId: "canonical-sports-djokovic-upset-headline",
    title: "Navone stuns Djokovic in New York",
    speaker: "Mara Vale",
    anchor: "anchor-004",
    dialogue:
      "Mara says, “Mariano Navone stunned Novak Djokovic in the US Open first round.”",
    action:
      "Mara introduces the result directly to camera; Theo listens without interrupting and holds the established desk position.",
  },
  {
    slot: "djokovic-upset-context",
    ordinal: 50,
    clipId: "canonical-sports-djokovic-upset-context",
    title: "Djokovic's earliest Slam exit since 2006",
    speaker: "Theo Reyes",
    anchor: "anchor-005",
    dialogue:
      "Theo says, “Navone won in five sets; Djokovic’s earliest Slam exit since 2006.”",
    action:
      "Theo gives the concise context while Mara listens; both settle naturally into the shared two-shot at the end.",
  },
  {
    slot: "alcaraz-return-headline",
    ordinal: 60,
    clipId: "canonical-sports-alcaraz-return-headline",
    title: "Alcaraz returns with a win",
    speaker: "Mara Vale",
    anchor: "anchor-006",
    dialogue:
      "Mara says, “Carlos Alcaraz returned from a four-month wrist layoff with a win.”",
    action:
      "Mara opens the next tennis headline with restrained energy; Theo turns slightly toward her, preserving the same camera axis.",
  },
  {
    slot: "alcaraz-return-context",
    ordinal: 70,
    clipId: "canonical-sports-alcaraz-return-context",
    title: "A straight-sets return for Alcaraz",
    speaker: "Theo Reyes",
    anchor: "anchor-007",
    dialogue:
      "Theo says, “He beat Roman Safiullin 6-4, 6-4, 6-4 and said his body felt great.”",
    action:
      "Theo delivers the score and health update calmly; Mara acknowledges with one subtle nod and returns to a neutral hold.",
  },
  {
    slot: "dutch-gp-headline",
    ordinal: 80,
    clipId: "canonical-sports-dutch-gp-headline",
    title: "Norris wins at Zandvoort",
    speaker: "Mara Vale",
    anchor: "anchor-008",
    dialogue:
      "Mara says, “Lando Norris won the Dutch Grand Prix after Max Verstappen crashed early.”",
    action:
      "Mara pivots cleanly to Formula One while Theo remains composed; no footage, graphics, or camera move appears.",
  },
  {
    slot: "dutch-gp-context",
    ordinal: 90,
    clipId: "canonical-sports-dutch-gp-context",
    title: "Antonelli and Russell complete the podium",
    speaker: "Theo Reyes",
    anchor: "anchor-009",
    dialogue:
      "Theo says, “Norris finished eleven seconds ahead of Kimi Antonelli, with George Russell third.”",
    action:
      "Theo closes the roundup; Mara listens, then both presenters settle into the same centered endpoint pose for a clean loop or continuation.",
  },
] as const;

export type SportsCanonicalSlot =
  (typeof SPORTS_CANONICAL_SPECS)[number]["slot"];
export const SportsCanonicalSlotSchema = Schema.Literals([
  "messi-headline",
  "messi-context",
  "us-open-reentry",
  "us-open-continuation",
  "djokovic-upset-headline",
  "djokovic-upset-context",
  "alcaraz-return-headline",
  "alcaraz-return-context",
  "dutch-gp-headline",
  "dutch-gp-context",
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
    episodeId: SPORTS_EPISODE_ID,
    currentAnchor: spec.anchor,
    branchStartAnchor: spec.anchor,
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
    `[TRUTHFULNESS] Use only the quoted sports-news wording. Do not depict any named athlete, match, race, stadium, circuit, highlights, logos, or supporting footage.`,
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
    continuityEndImageUrl: null,
    packageBeats: ["canonical"],
    grounding: null,
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
    "djokovic-upset-headline": "us-open-continuation-end.png",
    "djokovic-upset-context": "djokovic-upset-headline-end.png",
    "alcaraz-return-headline": "djokovic-upset-context-end.png",
    "alcaraz-return-context": "alcaraz-return-headline-end.png",
    "dutch-gp-headline": "alcaraz-return-context-end.png",
    "dutch-gp-context": "dutch-gp-headline-end.png",
  } as const;
  return `/v1/canonical/assets/${preceding[slot]}`;
}

export function canonicalBuildIdempotencyKey(
  slot: SportsCanonicalSlot,
  attempt: 1 | 2,
): string {
  if (slot === "messi-headline" && attempt === 2)
    return "canonical:messi-headline:v1:retry:2";
  return `canonical:${slot}:v1${attempt === 2 ? ":retry:2" : ""}`;
}

export function continuityAssetKey(slot: SportsCanonicalSlot): string {
  return `canonical/${SPORTS_EPISODE_ID}/continuity/${continuityAssetPath(slot).split("/").at(-1)}`;
}
