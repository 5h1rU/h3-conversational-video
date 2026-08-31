import {
  type BranchId,
  type ClipId,
  GenerationPlan,
  type SessionState,
} from "./domain";

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
      "Mara answers directly; Theo may react silently. Do not invent biography or expertise.",
  };
  const world = {
    show: "The Signal Room" as const,
    set: "Warm midnight-blue newsroom, amber practical lights, curved evidence desk, stable wardrobe.",
    cameraGrammar:
      "Locked medium two-shot; one restrained push-in; no cuts or new camera angles.",
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
    dialogue: `Mara, in one compact sentence, answer: “${input.question}” Then say: “Let’s rejoin the signal.”`,
    framing:
      "Mara foreground left, Theo listening right, eye lines remain on-axis.",
    motion:
      "Subtle breathing and one natural hand gesture; end in neutral listening pose.",
    audio: "Broadcast-clean dialogue, consistent room tone, no music change.",
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
    character,
    world,
    session,
    shot,
    resolvedPrompt,
  });
}
