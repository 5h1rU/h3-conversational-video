import { Schema } from "effect";

export const BUFFER_TARGET_MS = 20_000;
export const CLIP_DURATION_MS = 5_000;
export const CANONICAL_CLIP_COUNT = 144;

export const SessionId = Schema.NonEmptyString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;
export const BranchId = Schema.NonEmptyString.pipe(Schema.brand("BranchId"));
export type BranchId = typeof BranchId.Type;
export const ClipId = Schema.NonEmptyString.pipe(Schema.brand("ClipId"));
export type ClipId = typeof ClipId.Type;
export const ShowId = Schema.NonEmptyString.pipe(Schema.brand("ShowId"));
export type ShowId = typeof ShowId.Type;
export const EpisodeId = Schema.NonEmptyString.pipe(Schema.brand("EpisodeId"));
export type EpisodeId = typeof EpisodeId.Type;
export const EventId = Schema.NonEmptyString.pipe(Schema.brand("EventId"));
export type EventId = typeof EventId.Type;
export const ArtifactId = Schema.NonEmptyString.pipe(
  Schema.brand("ArtifactId"),
);
export type ArtifactId = typeof ArtifactId.Type;
export const TimelineRevision = Schema.Int.pipe(
  Schema.brand("TimelineRevision"),
);
export type TimelineRevision = typeof TimelineRevision.Type;
export const StateVersion = Schema.Int.pipe(Schema.brand("StateVersion"));
export type StateVersion = typeof StateVersion.Type;

export class CreateSessionPayload extends Schema.Class<CreateSessionPayload>(
  "h3/CreateSessionPayload",
)({
  sessionId: Schema.optional(SessionId),
  showId: Schema.optional(ShowId),
  episodeId: Schema.optional(EpisodeId),
  showVersion: Schema.optional(Schema.NonEmptyString),
}) {}

export class ViewerEventPayload extends Schema.Class<ViewerEventPayload>(
  "h3/ViewerEventPayload",
)({
  eventId: EventId,
  text: Schema.NonEmptyString,
  playbackPositionMs: Schema.Int,
  playlistRevision: TimelineRevision,
}) {}

export const BranchPhase = Schema.Literals([
  "idle",
  "planned",
  "generating",
  "ready",
  "failed",
]);
export type BranchPhase = typeof BranchPhase.Type;

export class SessionState extends Schema.Class<SessionState>("h3/SessionState")(
  {
    sessionId: SessionId,
    showId: ShowId,
    episodeId: EpisodeId,
    showVersion: Schema.NonEmptyString,
    stateVersion: StateVersion,
    canonicalPlayheadAnchor: Schema.NonEmptyString,
    bufferDepthMs: Schema.Int,
    targetBufferMs: Schema.Int,
    branchPhase: BranchPhase,
    branchId: Schema.NullOr(BranchId),
    branchQuestion: Schema.NullOr(Schema.String),
    rejoinAnchor: Schema.NullOr(Schema.String),
    branchArtifactId: Schema.NullOr(ArtifactId),
    playlistRevision: TimelineRevision,
    deadlineAt: Schema.NullOr(Schema.Int),
  },
) {}
export type SessionStateEncoded = typeof SessionState.Encoded;
export const encodeSessionState = Schema.encodeSync(SessionState);
export const decodeSessionState = Schema.decodeUnknownSync(SessionState);

export const CharacterContext = Schema.Struct({
  primary: Schema.Literal("Mara Vale"),
  secondary: Schema.Literal("Theo Reyes"),
  speakingRule: Schema.String,
});
export const WorldContext = Schema.Struct({
  show: Schema.Literal("The Signal Room"),
  set: Schema.String,
  cameraGrammar: Schema.String,
  visualDisclosure: Schema.String,
});
export const GenerationSessionContext = Schema.Struct({
  question: Schema.String,
  currentAnchor: Schema.String,
  rejoinAnchor: Schema.String,
});
export const ShotInstruction = Schema.Struct({
  purpose: Schema.Literal("answer-viewer-question"),
  dialogue: Schema.String,
  framing: Schema.String,
  motion: Schema.String,
  audio: Schema.String,
  terminalState: Schema.String,
});

export class GenerationPlan extends Schema.Class<GenerationPlan>(
  "h3/GenerationPlan",
)({
  compilerVersion: Schema.Literal("h3-compiler/1"),
  clipId: ClipId,
  branchId: BranchId,
  durationSeconds: Schema.Literal(5),
  seed: Schema.Int,
  character: CharacterContext,
  world: WorldContext,
  session: GenerationSessionContext,
  shot: ShotInstruction,
  resolvedPrompt: Schema.String,
}) {}

export class BranchGenerationJob extends Schema.Class<BranchGenerationJob>(
  "h3/BranchGenerationJob",
)({
  jobId: Schema.NonEmptyString,
  idempotencyKey: Schema.NonEmptyString,
  sessionId: SessionId,
  branchId: BranchId,
  clipId: ClipId,
  desiredOrdinal: Schema.Int,
  stateVersion: StateVersion,
  deadlineAt: Schema.Int,
  plan: GenerationPlan,
}) {}
export type BranchGenerationJobEncoded = typeof BranchGenerationJob.Encoded;

const FalVideo = Schema.Struct({
  url: Schema.URL,
  content_type: Schema.optional(Schema.String),
  file_name: Schema.optional(Schema.String),
  file_size: Schema.optional(Schema.Int),
});
const FalPayload = Schema.Struct({
  video: FalVideo,
  expanded_prompt: Schema.optional(Schema.String),
});
export class FalWebhookPayload extends Schema.Class<FalWebhookPayload>(
  "h3/FalWebhookPayload",
)({
  request_id: Schema.NonEmptyString,
  gateway_request_id: Schema.optional(Schema.String),
  status: Schema.Literals(["OK", "ERROR"]),
  payload: Schema.optional(Schema.NullOr(FalPayload)),
  error: Schema.optional(Schema.String),
}) {}

export const decodeCreateSessionPayload =
  Schema.decodeUnknownEffect(CreateSessionPayload);
export const decodeViewerEventPayload =
  Schema.decodeUnknownEffect(ViewerEventPayload);
export const decodeBranchGenerationJob =
  Schema.decodeUnknownEffect(BranchGenerationJob);
export const encodeBranchGenerationJob =
  Schema.encodeEffect(BranchGenerationJob);
export const decodeFalWebhookPayload =
  Schema.decodeUnknownEffect(FalWebhookPayload);

export type ClipSource = "canonical" | "branch" | "reentry";
export interface ClipQueueEntry {
  readonly ordinal: number;
  readonly id: string;
  readonly source: ClipSource;
  readonly title: string;
  readonly speaker: string;
  readonly durationMs: number;
  readonly mediaUrl: string;
  readonly anchor: string;
  readonly committed: true;
}

const beats = [
  "The signal behind the headline",
  "What changed today",
  "The human consequence",
  "Mara tests the claim",
  "Theo challenges the assumption",
  "The evidence board",
  "What to watch next",
  "A practical takeaway",
] as const;

export function anchorForIndex(index: number): string {
  return `anchor-${String(index).padStart(3, "0")}`;
}

export function canonicalClip(index: number): ClipQueueEntry {
  const beat = beats[index % beats.length] ?? beats[0];
  return {
    ordinal: index * 10,
    id: `canonical-${String(index).padStart(3, "0")}`,
    source: "canonical",
    title: `${beat} · ${Math.floor(index / beats.length) + 1}`,
    speaker: index % 2 === 0 ? "Mara Vale" : "Theo Reyes",
    durationMs: CLIP_DURATION_MS,
    mediaUrl: `/v1/fixtures/${index % 8}.svg`,
    anchor: anchorForIndex(index),
    committed: true,
  };
}

export function canonicalTimeline(): ReadonlyArray<ClipQueueEntry> {
  return Array.from({ length: CANONICAL_CLIP_COUNT }, (_, index) =>
    canonicalClip(index),
  );
}
