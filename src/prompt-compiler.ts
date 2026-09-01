import {
  type BranchId,
  type ClipId,
  type GroundedAnswerPlan,
  GenerationPlan,
  type SessionState,
} from "./domain";
import { SPORTS_VISUAL_BIBLE } from "./canonical-sports";

function deterministicSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function continuityBridgePath(branchStartAnchor: string): string {
  switch (branchStartAnchor) {
    case "anchor-000":
      return "/v1/canonical/assets/messi-headline-end.png";
    case "anchor-002":
      return "/v1/canonical/assets/us-open-reentry-end.png";
    case "anchor-003":
      return "/v1/canonical/assets/us-open-continuation-end.png";
    case "anchor-004":
      return "/v1/canonical/assets/djokovic-upset-headline-end.png";
    case "anchor-005":
      return "/v1/canonical/assets/djokovic-upset-context-end.png";
    case "anchor-006":
      return "/v1/canonical/assets/alcaraz-return-headline-end.png";
    case "anchor-007":
      return "/v1/canonical/assets/alcaraz-return-context-end.png";
    case "anchor-008":
      return "/v1/canonical/assets/dutch-gp-headline-end.png";
    default:
      return "/v1/canonical/assets/messi-context-end.png";
  }
}

export function compileGenerationPlan(input: {
  branchId: BranchId;
  clipId: ClipId;
  question: string;
  state: SessionState;
  branchStartAnchor: string;
  rejoinAnchor: string;
  continuityBaseUrl: URL;
  groundedAnswer?: GroundedAnswerPlan;
  currentAnchor?: string;
}): GenerationPlan {
  const groundedAnswer = input.groundedAnswer;
  const character = {
    primary: "Mara Vale" as const,
    secondary: "Theo Reyes" as const,
    speakingRule:
      "Treat the viewer as part of the live program. Use at most sixteen spoken words total: a brief subject-specific acknowledgment, one concise factual answer, and a very short organic handoff. Speak at a calm natural news cadence. Never accelerate, time-compress, or rush speech. Do not use a canned receipt phrase, repeat the whole question, or invent facts.",
  };
  const world = {
    show: "The Signal Room" as const,
    set: SPORTS_VISUAL_BIBLE.studio,
    cameraGrammar: SPORTS_VISUAL_BIBLE.camera,
    visualDisclosure:
      "Small persistent GENERATED label in lower-right safe area.",
  };
  const session = {
    question: input.question,
    episodeId: input.state.episodeId,
    currentAnchor: input.currentAnchor ?? input.state.canonicalPlayheadAnchor,
    branchStartAnchor: input.branchStartAnchor,
    rejoinAnchor: input.rejoinAnchor,
  };
  const shot = {
    purpose: "answer-viewer-question" as const,
    dialogue: groundedAnswer
      ? `[INGRESS] ${groundedAnswer.ingress} [ANSWER] ${groundedAnswer.answer} [EGRESS] ${groundedAnswer.egress}`
      : `[INGRESS] The live audience asks: “${input.question}” Mara naturally acknowledges that exact subject in one short clause, using wording such as “A viewer is asking…” or “The audience is asking…” only when it sounds conversational. [ANSWER] She gives one compact, truthful sentence that directly answers it. [EGRESS] She closes the exchange with a brief neutral handoff, without naming or previewing the fixed next story. Never say “we received a question,” repeat the full question, or invent a fact.`,
    framing:
      "Mara foreground left, Theo listening right, eye lines remain on-axis.",
    motion:
      "Begin exactly from the supplied first keyframe. Use subtle breathing, eye contact between the anchors, and at most one restrained hand gesture. During the final second, finish the gesture, return both heads and eye lines to the supplied last keyframe, and hold that exact neutral pose through the cut.",
    audio: SPORTS_VISUAL_BIBLE.audio,
    terminalState:
      "The final frame must match the supplied last keyframe: Mara frame-left and Theo frame-right at the desk, identical head direction, eye line, shoulders, hands, camera, lighting, and expression. No movement may continue across the cut.",
  };
  const resolvedPrompt = [
    `[CHARACTER] ${character.primary} and ${character.secondary}. ${character.speakingRule}`,
    `[WORLD] ${world.set} ${world.cameraGrammar} ${world.visualDisclosure}`,
    `[SESSION] Viewer-now=${session.currentAnchor}; branch-start=${session.branchStartAnchor}; rejoin=${session.rejoinAnchor}; viewer=${session.question}`,
    `[SHOT] ${shot.dialogue} ${shot.framing} ${shot.motion} ${shot.audio} End: ${shot.terminalState}`,
    groundedAnswer
      ? `[GROUNDING] Speak the supplied ingress, answer, and egress exactly as written. The answer was grounded at ${groundedAnswer.informationAsOf} with ${groundedAnswer.sources.length} validated source(s). Do not add, remove, paraphrase, or invent facts.`
      : "[GROUNDING] This draft is unresolved and must not be submitted to a live video provider.",
    "[TIMING] Ingress 0.0-1.2s; direct answer 1.2-5.2s; egress 5.2-6.2s; silent exact-pose restoration 6.2-7.0s. Use at most sixteen spoken words total at a calm 135-150 words-per-minute news cadence. Never accelerate, time-stretch, compress, or rush the voice to fit. One continuous locked two-shot, no cut or camera move.",
    `[CONTINUITY] The supplied first and last images are the exact shared endpoint frame at ${session.branchStartAnchor}, immediately before ${session.rejoinAnchor}. Begin from it and restore it exactly before the canonical program resumes. Preserve faces, wardrobe, studio, voices, room tone, camera axis, exposure, and color grade throughout.`,
    "Seven seconds, 16:9, coherent audiovisual output, safety checker enabled.",
  ].join("\n");

  const bridgeKeyframe = new URL(
    continuityBridgePath(input.branchStartAnchor),
    input.continuityBaseUrl,
  );

  return new GenerationPlan({
    compilerVersion: groundedAnswer ? "h3-compiler/5" : "h3-compiler/3",
    clipId: input.clipId,
    branchId: input.branchId,
    durationSeconds: 7,
    seed: deterministicSeed(
      `${input.branchId}:${input.question}:${input.rejoinAnchor}`,
    ),
    providerModel: "minimax/h3-max/image-to-video",
    continuityStartImageUrl: bridgeKeyframe,
    continuityEndImageUrl: bridgeKeyframe,
    packageBeats: ["ingress", "answer", "egress"],
    grounding: groundedAnswer ?? null,
    character,
    world,
    session,
    shot,
    resolvedPrompt,
  });
}
