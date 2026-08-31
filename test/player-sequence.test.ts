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
  it("transitions canonical -> one branch -> one re-entry -> canonical", () => {
    const completed = new Set<string>();

    const selected = selectRefreshClipId(
      published,
      canonicalBefore.id,
      completed,
    );
    expect(selected).toBe(branch.id);
    expect(selectRefreshClipId(published, branch.id, completed)).toBe(
      branch.id,
    );

    completed.add(branch.id);
    const afterBranch = selectNextClipId(published, branch.id);
    expect(afterBranch).toBe(reentry.id);
    expect(selectRefreshClipId(published, afterBranch, completed)).toBe(
      reentry.id,
    );
    expect(selectNextClipId(published, reentry.id)).toBe(canonicalAfter.id);
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
