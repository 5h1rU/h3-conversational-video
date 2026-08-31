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
  rejoinAnchor: string;
}): GenerationPlan {
  const character = {
    primary: "Mara Vale" as const,
    secondary: "Theo Reyes" as const,
    speakingRule:
      "Choose natural wording for the exact viewer question. Acknowledge it briefly, answer concisely, and bridge organically to the next headline. Do not use a canned receipt phrase or invent facts.",
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
    rejoinAnchor: input.rejoinAnchor,
  };
  const shot = {
    purpose: "answer-viewer-question" as const,
    dialogue: `The viewer asks: “${input.question}” Mara naturally acknowledges the substance of that exact question, gives one compact truthful answer, then chooses her own concise egress wording that makes the move to an independent next headline feel natural. Never say “we received a question” and never quote an unknown answer as fact.`,
    framing:
      "Mara foreground left, Theo listening right, eye lines remain on-axis.",
    motion:
      "Subtle breathing and one natural hand gesture; end in neutral listening pose.",
    audio: SPORTS_VISUAL_BIBLE.audio,
    terminalState:
      "Both panelists face the evidence wall, ready for canonical re-entry.",
  };
  const resolvedPrompt = [
    `[CHARACTER] ${character.primary} and ${character.secondary}. ${character.speakingRule}`,
    `[WORLD] ${world.set} ${world.cameraGrammar} ${world.visualDisclosure}`,
    `[SESSION] Current=${session.currentAnchor}; rejoin=${session.rejoinAnchor}; viewer=${session.question}`,
    `[SHOT] ${shot.dialogue} ${shot.framing} ${shot.motion} ${shot.audio} End: ${shot.terminalState}`,
    "Five seconds, 16:9, coherent audiovisual output, safety checker enabled.",
  ].join("\n");

  return new GenerationPlan({
    compilerVersion: "h3-compiler/1",
    clipId: input.clipId,
    branchId: input.branchId,
    durationSeconds: 5,
    seed: deterministicSeed(
      `${input.branchId}:${input.question}:${input.rejoinAnchor}`,
    ),
    providerModel: "minimax/h3-max/image-to-video",
    continuityStartImageUrl: new URL(
      "/v1/canonical/assets/messi-context-end.png",
      "https://h3-conversational-video-prototype.yo-617.workers.dev",
    ),
    packageBeats: ["ingress", "answer", "egress"],
    character,
    world,
    session,
    shot,
    resolvedPrompt,
  });
}
