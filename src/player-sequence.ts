export interface SequencedClip {
  readonly id: string;
  readonly source: "canonical" | "branch" | "reentry";
}

export function selectRefreshClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string | null,
  completedBranchIds: ReadonlySet<string>,
): string | null {
  const current = entries.find((entry) => entry.id === currentClipId);
  if (current?.source === "branch") return current.id;

  const unplayedBranch = entries.find(
    (entry) => entry.source === "branch" && !completedBranchIds.has(entry.id),
  );
  if (unplayedBranch) return unplayedBranch.id;

  return current?.id ?? entries[0]?.id ?? null;
}

export function selectNextClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string,
): string | null {
  if (entries.length === 0) return null;
  const currentIndex = entries.findIndex((entry) => entry.id === currentClipId);
  if (currentIndex < 0) return entries[0]?.id ?? null;
  return entries[(currentIndex + 1) % entries.length]?.id ?? null;
}
