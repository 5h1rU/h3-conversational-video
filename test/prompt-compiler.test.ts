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
      branchStartAnchor: "anchor-001",
      rejoinAnchor: "anchor-007",
      continuityBaseUrl: new URL("https://prototype.example"),
    };
    const first = compileGenerationPlan(input);
    const second = compileGenerationPlan(input);
    expect(first).toEqual(second);
    expect(first.character.primary).toBe("Mara Vale");
    expect(first.world.show).toBe("The Signal Room");
    expect(first.session.rejoinAnchor).toBe("anchor-007");
    expect(first.session.branchStartAnchor).toBe("anchor-001");
    expect(first.compilerVersion).toBe("h3-compiler/3");
    expect(first.durationSeconds).toBe(7);
    expect(first.continuityStartImageUrl?.href).toBe(
      "https://prototype.example/v1/canonical/assets/messi-context-end.png",
    );
    expect(first.continuityEndImageUrl).toEqual(first.continuityStartImageUrl);
    expect(first.shot.purpose).toBe("answer-viewer-question");
    expect(first.resolvedPrompt).toContain("[CHARACTER]");
    expect(first.resolvedPrompt).toContain("[WORLD]");
    expect(first.resolvedPrompt).toContain("[SESSION]");
    expect(first.resolvedPrompt).toContain("[SHOT]");
    expect(first.resolvedPrompt).toContain("[INGRESS]");
    expect(first.resolvedPrompt).toContain("[ANSWER]");
    expect(first.resolvedPrompt).toContain("[EGRESS]");
    expect(first.resolvedPrompt).toContain("exact-pose restoration");
    expect(first.resolvedPrompt).toContain("1.2-5.2s");
    expect(first.resolvedPrompt).toContain("at most sixteen spoken words");
    expect(first.resolvedPrompt).toContain("Never accelerate");
  });

  it("selects the exact immutable bridge frame for later sports anchors", () => {
    const state = Schema.decodeUnknownSync(SessionState)({
      sessionId: "session-late-anchor",
      showId: "signal-room-sports",
      episodeId: "sports-news-2026-08-31",
      showVersion: "2026-08-31.sports.v2",
      stateVersion: 1,
      canonicalPlayheadAnchor: "anchor-007",
      bufferDepthMs: 20_000,
      targetBufferMs: 20_000,
      branchPhase: "planned",
      branchId: "branch-late-anchor",
      branchQuestion: "What happened in Formula One?",
      rejoinAnchor: "anchor-008",
      branchArtifactId: null,
      playlistRevision: 1,
      deadlineAt: 9_999_999_999_999,
    });
    const plan = compileGenerationPlan({
      branchId: Schema.decodeUnknownSync(BranchId)("branch-late-anchor"),
      clipId: Schema.decodeUnknownSync(ClipId)("clip-late-anchor"),
      question: "What happened in Formula One?",
      state,
      branchStartAnchor: "anchor-007",
      rejoinAnchor: "anchor-008",
      continuityBaseUrl: new URL("https://prototype.example"),
      currentAnchor: "anchor-007",
    });
    expect(plan.continuityStartImageUrl?.pathname).toBe(
      "/v1/canonical/assets/alcaraz-return-context-end.png",
    );
    expect(plan.continuityEndImageUrl).toEqual(plan.continuityStartImageUrl);
  });
});
