import { describe, expect, it } from "vitest";
import {
  selectNextClipId,
  selectRefreshClipId,
  type SequencedClip,
} from "../src/player-sequence";

const canonicalBefore: SequencedClip = {
  id: "canonical-before",
  source: "canonical",
};
const branch: SequencedClip = { id: "branch-once", source: "branch" };
const reentry: SequencedClip = { id: "reentry-once", source: "reentry" };
const canonicalAfter: SequencedClip = {
  id: "canonical-after",
  source: "canonical",
};
const published = [canonicalBefore, branch, reentry, canonicalAfter];

describe("viewer playback sequence", () => {
  it("does not interrupt canonical media when a branch arrives during polling", () => {
    const completed = new Set<string>();
    expect(selectRefreshClipId(published, canonicalBefore.id, completed)).toBe(
      canonicalBefore.id,
    );
    expect(selectNextClipId(published, canonicalBefore.id, completed)).toBe(
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
    const combined = [canonicalBefore, branch, canonicalAfter];
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
});
