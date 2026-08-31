export interface SequencedClip {
  readonly id: string;
  readonly source: "canonical" | "branch" | "reentry";
}

export interface BufferedClip extends SequencedClip {
  readonly mediaUrl: string;
}

export interface MediaSlotState {
  readonly clipId: string | null;
  readonly status: "empty" | "loading" | "ready" | "active" | "error";
}

export function canonicalPreloadUrls(
  entries: ReadonlyArray<BufferedClip>,
): ReadonlyArray<string> {
  return [
    ...new Set(
      entries
        .filter(
          (entry) =>
            entry.source === "canonical" && entry.mediaUrl.includes("/media/"),
        )
        .map((entry) => entry.mediaUrl),
    ),
  ];
}

export function canCommitMediaHandoff(
  active: MediaSlotState,
  standby: MediaSlotState,
  targetClipId: string,
): boolean {
  return (
    active.status === "active" &&
    standby.status === "ready" &&
    standby.clipId === targetClipId &&
    active.clipId !== targetClipId
  );
}

export function shouldAdvanceFromEnded(
  activeClipId: string | null,
  eventClipId: string | null,
  transitionInProgress: boolean,
): boolean {
  return (
    !transitionInProgress &&
    activeClipId !== null &&
    activeClipId === eventClipId
  );
}

export function selectRefreshClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string | null,
  completedBranchIds: ReadonlySet<string>,
): string | null {
  const current = entries.find((entry) => entry.id === currentClipId);
  if (current) return current.id;

  const unplayedBranch = entries.find(
    (entry) => entry.source === "branch" && !completedBranchIds.has(entry.id),
  );
  if (unplayedBranch) return unplayedBranch.id;

  return entries[0]?.id ?? null;
}

export function selectNextClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string,
  completedBranchIds: ReadonlySet<string>,
): string | null {
  if (entries.length === 0) return null;
  const currentIndex = entries.findIndex((entry) => entry.id === currentClipId);
  if (currentIndex < 0) return entries[0]?.id ?? null;
  const current = entries[currentIndex];
  if (current?.source === "canonical") {
    const pendingBranch = entries.find(
      (entry) => entry.source === "branch" && !completedBranchIds.has(entry.id),
    );
    if (pendingBranch) return pendingBranch.id;
  }
  return entries[(currentIndex + 1) % entries.length]?.id ?? null;
}

export function selectNextPlayableClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string,
  completedBranchIds: ReadonlySet<string>,
  unavailableClipIds: ReadonlySet<string>,
): string | null {
  const completed = new Set(completedBranchIds);
  let cursor = currentClipId;
  for (let attempt = 0; attempt < entries.length; attempt += 1) {
    const candidate = selectNextClipId(entries, cursor, completed);
    if (!candidate) return null;
    if (!unavailableClipIds.has(candidate)) return candidate;
    const entry = entries.find((item) => item.id === candidate);
    if (entry?.source === "branch") completed.add(candidate);
    cursor = candidate;
  }
  return null;
}
