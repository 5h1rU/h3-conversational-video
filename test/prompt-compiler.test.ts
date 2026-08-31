import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BranchId, ClipId, SessionState } from "../src/domain";
import { compileGenerationPlan } from "../src/prompt-compiler";

describe("deterministic generation plan compiler", () => {
  it("separates character, world, session, and shot context with a stable seed", () => {
    const state = Schema.decodeUnknownSync(SessionState)({
      sessionId: "session-compiler",
      showId: "signal-room",
      episodeId: "episode-001",
      showVersion: "v1",
      stateVersion: 1,
      canonicalPlayheadAnchor: "anchor-003",
      bufferDepthMs: 20_000,
      targetBufferMs: 20_000,
      branchPhase: "idle",
      branchId: null,
      branchQuestion: null,
      rejoinAnchor: null,
      branchArtifactId: null,
      playlistRevision: 1,
      deadlineAt: null,
    });
    const input = {
      branchId: Schema.decodeUnknownSync(BranchId)("branch-compiler"),
      clipId: Schema.decodeUnknownSync(ClipId)("clip-compiler"),
      question: "Why does the buffer matter?",
      state,
      rejoinAnchor: "anchor-007",
    };
    const first = compileGenerationPlan(input);
    const second = compileGenerationPlan(input);
    expect(first).toEqual(second);
    expect(first.character.primary).toBe("Mara Vale");
    expect(first.world.show).toBe("The Signal Room");
    expect(first.session.rejoinAnchor).toBe("anchor-007");
    expect(first.shot.purpose).toBe("answer-viewer-question");
    expect(first.resolvedPrompt).toContain("[CHARACTER]");
    expect(first.resolvedPrompt).toContain("[WORLD]");
    expect(first.resolvedPrompt).toContain("[SESSION]");
    expect(first.resolvedPrompt).toContain("[SHOT]");
  });
});
