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

export function selectImmediateReadyBranchId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string | null,
  completedBranchIds: ReadonlySet<string>,
  queuedBranchId: string | null,
): string | null {
  if (currentClipId === null) return null;
  const current = entries.find((entry) => entry.id === currentClipId);
  if (!current || current.source !== "canonical") return queuedBranchId;
  if (
    queuedBranchId !== null &&
    entries.some(
      (entry) =>
        entry.id === queuedBranchId &&
        entry.source === "branch" &&
        !completedBranchIds.has(entry.id),
    )
  ) {
    return queuedBranchId;
  }
  return (
    entries.find(
      (entry) => entry.source === "branch" && !completedBranchIds.has(entry.id),
    )?.id ?? null
  );
}

export function projectImmediateBranchPackage(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string | null,
  queuedBranchId: string | null,
): ReadonlyArray<SequencedClip> {
  if (currentClipId === null || queuedBranchId === null) return entries;
  const branchIndex = entries.findIndex(
    (entry) => entry.id === queuedBranchId && entry.source === "branch",
  );
  if (branchIndex < 0) return entries;
  const packageEntries = [entries[branchIndex]!];
  const possibleReentry = entries[branchIndex + 1];
  if (possibleReentry?.source === "reentry")
    packageEntries.push(possibleReentry);
  const packageIds = new Set(packageEntries.map((entry) => entry.id));
  const withoutPackage = entries.filter((entry) => !packageIds.has(entry.id));
  const currentIndex = withoutPackage.findIndex(
    (entry) => entry.id === currentClipId,
  );
  if (currentIndex < 0) return entries;
  return [
    ...withoutPackage.slice(0, currentIndex + 1),
    ...packageEntries,
    ...withoutPackage.slice(currentIndex + 1),
  ];
}

export function immediateBranchPackageTailId(
  entries: ReadonlyArray<SequencedClip>,
  queuedBranchId: string | null,
): string | null {
  if (queuedBranchId === null) return null;
  const branchIndex = entries.findIndex(
    (entry) => entry.id === queuedBranchId && entry.source === "branch",
  );
  if (branchIndex < 0) return null;
  const possibleReentry = entries[branchIndex + 1];
  return possibleReentry?.source === "reentry"
    ? possibleReentry.id
    : queuedBranchId;
}

export function shouldClearImmediateBranchQueue(
  finishedClipId: string | null,
  packageTailId: string | null,
  unavailableClipIds: ReadonlySet<string>,
): boolean {
  return (
    packageTailId !== null &&
    (finishedClipId === packageTailId || unavailableClipIds.has(packageTailId))
  );
}

export function selectNextClipId(
  entries: ReadonlyArray<SequencedClip>,
  currentClipId: string,
  completedBranchIds: ReadonlySet<string>,
): string | null {
  if (entries.length === 0) return null;
  const currentIndex = entries.findIndex((entry) => entry.id === currentClipId);
  if (currentIndex < 0) return entries[0]?.id ?? null;
  for (let offset = 1; offset <= entries.length; offset += 1) {
    const candidate = entries[(currentIndex + offset) % entries.length];
    if (!candidate) continue;
    if (candidate.source === "branch" && completedBranchIds.has(candidate.id))
      continue;
    return candidate.id;
  }
  return null;
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
