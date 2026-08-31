import {
  type BranchId,
  type ClipId,
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

export function compileGenerationPlan(input: {
  branchId: BranchId;
  clipId: ClipId;
  question: string;
  state: SessionState;
  branchStartAnchor: string;
  rejoinAnchor: string;
  continuityBaseUrl: URL;
}): GenerationPlan {
  const character = {
    primary: "Mara Vale" as const,
    secondary: "Theo Reyes" as const,
    speakingRule:
      "Treat the viewer as part of the live program. Choose natural wording for the exact question: briefly acknowledge that a viewer or the audience is asking about its subject, answer in one concise sentence, and close with an organic handoff. Do not use a canned receipt phrase, repeat the whole question, or invent facts.",
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
    currentAnchor: input.state.canonicalPlayheadAnchor,
    branchStartAnchor: input.branchStartAnchor,
    rejoinAnchor: input.rejoinAnchor,
  };
  const shot = {
    purpose: "answer-viewer-question" as const,
    dialogue: `[INGRESS] The live audience asks: “${input.question}” Mara naturally acknowledges that exact subject in one short clause, using wording such as “A viewer is asking…” or “The audience is asking…” only when it sounds conversational. [ANSWER] She gives one compact, truthful sentence that directly answers it. [EGRESS] She closes the exchange with a brief neutral handoff, without naming or previewing the fixed next story. Never say “we received a question,” repeat the full question, or invent a fact.`,
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
    "[TIMING] Ingress 0.0-1.0s; direct answer 1.0-3.8s; egress and exact pose restoration 3.8-5.0s. One continuous locked two-shot, no cut or camera move.",
    "[CONTINUITY] The supplied first image is the exact outgoing Messi-context frame. The supplied last image is the exact incoming US Open keyframe. Preserve faces, wardrobe, studio, voices, room tone, camera axis, exposure, and color grade between them.",
    "Five seconds, 16:9, coherent audiovisual output, safety checker enabled.",
  ].join("\n");

  const bridgeKeyframe = new URL(
    "/v1/canonical/assets/messi-context-end.png",
    input.continuityBaseUrl,
  );

  return new GenerationPlan({
    compilerVersion: "h3-compiler/2",
    clipId: input.clipId,
    branchId: input.branchId,
    durationSeconds: 5,
    seed: deterministicSeed(
      `${input.branchId}:${input.question}:${input.rejoinAnchor}`,
    ),
    providerModel: "minimax/h3-max/image-to-video",
    continuityStartImageUrl: bridgeKeyframe,
    continuityEndImageUrl: bridgeKeyframe,
    packageBeats: ["ingress", "answer", "egress"],
    character,
    world,
    session,
    shot,
    resolvedPrompt,
  });
}
