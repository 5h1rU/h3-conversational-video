import { describe, expect, it } from "vitest";
import {
  canCommitMediaHandoff,
  canonicalPreloadUrls,
  immediateBranchPackageTailId,
  projectImmediateBranchPackage,
  selectImmediateReadyBranchId,
  selectNextClipId,
  selectNextPlayableClipId,
  selectRefreshClipId,
  shouldAdvanceFromEnded,
  shouldClearImmediateBranchQueue,
  type BufferedClip,
  type SequencedClip,
} from "../src/player-sequence";

const canonicalBefore: SequencedClip = {
  id: "canonical-before",
  source: "canonical",
};
const canonicalContext: SequencedClip = {
  id: "canonical-context",
  source: "canonical",
};
const branch: SequencedClip = { id: "branch-once", source: "branch" };
const reentry: SequencedClip = { id: "reentry-once", source: "reentry" };
const canonicalAfter: SequencedClip = {
  id: "canonical-after",
  source: "canonical",
};
const published = [
  canonicalBefore,
  canonicalContext,
  branch,
  reentry,
  canonicalAfter,
];

describe("viewer playback sequence", () => {
  it("does not interrupt canonical media when a branch arrives during polling", () => {
    const completed = new Set<string>();
    expect(selectRefreshClipId(published, canonicalBefore.id, completed)).toBe(
      canonicalBefore.id,
    );
    expect(selectNextClipId(published, canonicalBefore.id, completed)).toBe(
      canonicalContext.id,
    );
    expect(selectNextClipId(published, canonicalContext.id, completed)).toBe(
      branch.id,
    );
    expect(selectRefreshClipId(published, branch.id, completed)).toBe(
      branch.id,
    );
  });

  it("supports an explicit branch -> re-entry -> canonical package", () => {
    const completed = new Set<string>();

    completed.add(branch.id);
    const afterBranch = selectNextClipId(published, branch.id, completed);
    expect(afterBranch).toBe(reentry.id);
    expect(selectRefreshClipId(published, afterBranch, completed)).toBe(
      reentry.id,
    );
    expect(selectNextClipId(published, reentry.id, completed)).toBe(
      canonicalAfter.id,
    );
  });

  it("supports a cost-first branch with ingress, answer, and egress combined", () => {
    const combined = [
      canonicalBefore,
      canonicalContext,
      branch,
      canonicalAfter,
    ];
    const completed = new Set([branch.id]);
    expect(selectNextClipId(combined, branch.id, completed)).toBe(
      canonicalAfter.id,
    );
  });

  it("preserves the active clip by identity when polling replaces the array", () => {
    const completed = new Set([branch.id]);
    const reordered = [branch, reentry, canonicalBefore, canonicalAfter];

    expect(selectRefreshClipId(reordered, canonicalBefore.id, completed)).toBe(
      canonicalBefore.id,
    );
  });

  it("does not replay a completed branch on later playlist polls", () => {
    expect(
      selectRefreshClipId(published, canonicalAfter.id, new Set([branch.id])),
    ).toBe(canonicalAfter.id);
  });

  it("queues a newly ready branch immediately after the active canonical clip", () => {
    const latePublication = [
      branch,
      canonicalBefore,
      canonicalContext,
      canonicalAfter,
    ];
    const queued = selectImmediateReadyBranchId(
      latePublication,
      canonicalContext.id,
      new Set(),
      null,
    );
    expect(queued).toBe(branch.id);
    expect(
      projectImmediateBranchPackage(
        latePublication,
        canonicalContext.id,
        queued,
      ).map((entry) => entry.id),
    ).toEqual([
      canonicalBefore.id,
      canonicalContext.id,
      branch.id,
      canonicalAfter.id,
    ]);
  });

  it("keeps an explicit branch and re-entry together before resuming forward", () => {
    const branchBehindPlayback = [
      canonicalBefore,
      branch,
      reentry,
      canonicalContext,
      canonicalAfter,
    ];
    const projected = projectImmediateBranchPackage(
      branchBehindPlayback,
      canonicalContext.id,
      branch.id,
    );
    expect(projected.map((entry) => entry.id)).toEqual([
      canonicalBefore.id,
      canonicalContext.id,
      branch.id,
      reentry.id,
      canonicalAfter.id,
    ]);
    expect(immediateBranchPackageTailId(projected, branch.id)).toBe(reentry.id);
  });

  it("keeps the same immediate branch projection across playlist polls", () => {
    const firstPoll = [
      branch,
      canonicalBefore,
      canonicalContext,
      canonicalAfter,
    ];
    const queued = selectImmediateReadyBranchId(
      firstPoll,
      canonicalContext.id,
      new Set(),
      null,
    );
    const secondPoll = firstPoll.map((entry) => ({ ...entry }));
    expect(
      selectImmediateReadyBranchId(
        secondPoll,
        canonicalContext.id,
        new Set(),
        queued,
      ),
    ).toBe(branch.id);
    expect(
      projectImmediateBranchPackage(
        secondPoll,
        canonicalContext.id,
        queued,
      ).map((entry) => entry.id),
    ).toEqual([
      canonicalBefore.id,
      canonicalContext.id,
      branch.id,
      canonicalAfter.id,
    ]);
  });

  it("clears an immediate combined branch after playback or media fallback", () => {
    expect(
      shouldClearImmediateBranchQueue(branch.id, branch.id, new Set()),
    ).toBe(true);
    expect(
      shouldClearImmediateBranchQueue(
        canonicalContext.id,
        branch.id,
        new Set([branch.id]),
      ),
    ).toBe(true);
    expect(
      shouldClearImmediateBranchQueue(branch.id, reentry.id, new Set()),
    ).toBe(false);
  });

  it("preloads the complete unique canonical media set", () => {
    const clips: ReadonlyArray<BufferedClip> = [
      { ...canonicalBefore, mediaUrl: "/v1/sessions/a/media/canonical-a" },
      { ...canonicalBefore, mediaUrl: "/v1/sessions/a/media/canonical-a" },
      { ...branch, mediaUrl: "/v1/sessions/a/media/branch" },
      { ...canonicalAfter, mediaUrl: "/v1/sessions/a/media/canonical-b" },
    ];
    expect(canonicalPreloadUrls(clips)).toEqual([
      "/v1/sessions/a/media/canonical-a",
      "/v1/sessions/a/media/canonical-b",
    ]);
  });

  it("does not commit a handoff until the exact standby clip is frame-ready", () => {
    const active = { clipId: canonicalBefore.id, status: "active" } as const;
    expect(
      canCommitMediaHandoff(
        active,
        { clipId: canonicalAfter.id, status: "loading" },
        canonicalAfter.id,
      ),
    ).toBe(false);
    expect(
      canCommitMediaHandoff(
        active,
        { clipId: "wrong", status: "ready" },
        canonicalAfter.id,
      ),
    ).toBe(false);
    expect(
      canCommitMediaHandoff(
        active,
        { clipId: canonicalAfter.id, status: "ready" },
        canonicalAfter.id,
      ),
    ).toBe(true);
  });

  it("accepts one ended event only from the current active identity", () => {
    expect(
      shouldAdvanceFromEnded(canonicalBefore.id, canonicalBefore.id, false),
    ).toBe(true);
    expect(shouldAdvanceFromEnded(canonicalBefore.id, branch.id, false)).toBe(
      false,
    );
    expect(
      shouldAdvanceFromEnded(canonicalBefore.id, canonicalBefore.id, true),
    ).toBe(false);
  });

  it("skips failed media without replaying a branch or breaking re-entry", () => {
    const completed = new Set<string>();
    const unavailable = new Set([branch.id]);
    expect(
      selectNextPlayableClipId(
        published,
        canonicalContext.id,
        completed,
        unavailable,
      ),
    ).toBe(reentry.id);
    expect(
      selectNextPlayableClipId(
        published,
        reentry.id,
        new Set([branch.id]),
        unavailable,
      ),
    ).toBe(canonicalAfter.id);
  });
});
