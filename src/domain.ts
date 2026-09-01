import { Schema } from "effect";

export const BUFFER_TARGET_MS = 20_000;
export const BRANCH_GENERATION_DEADLINE_MS = 120_000;
export const CLIP_DURATION_MS = 5_000;
export const BRANCH_CLIP_DURATION_MS = 7_000;
export const CANONICAL_CLIP_COUNT = 144;

export const VideoDurationSeconds = Schema.Literals([5, 7]);
export type VideoDurationSeconds = typeof VideoDurationSeconds.Type;
export const MediaDurationMs = Schema.Literals([5_000, 7_000]);
export type MediaDurationMs = typeof MediaDurationMs.Type;

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

export const ClipSourceSchema = Schema.Literals([
  "canonical",
  "branch",
  "reentry",
]);
export type ClipSource = typeof ClipSourceSchema.Type;
export class ClipQueueEntrySchema extends Schema.Class<ClipQueueEntrySchema>(
  "h3/ClipQueueEntry",
)({
  ordinal: Schema.Int,
  id: Schema.NonEmptyString,
  source: ClipSourceSchema,
  title: Schema.NonEmptyString,
  speaker: Schema.NonEmptyString,
  durationMs: Schema.Int,
  mediaUrl: Schema.NonEmptyString,
  anchor: Schema.NonEmptyString,
  committed: Schema.Literal(true),
}) {}
export type ClipQueueEntry = typeof ClipQueueEntrySchema.Type;

export class CreateSessionPayload extends Schema.Class<CreateSessionPayload>(
  "h3/CreateSessionPayload",
)({
  sessionId: Schema.optional(SessionId),
  showId: Schema.optional(ShowId),
  episodeId: Schema.optional(EpisodeId),
  showVersion: Schema.optional(Schema.NonEmptyString),
  canonicalEntries: Schema.optional(Schema.Array(ClipQueueEntrySchema)),
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
  episodeId: Schema.NonEmptyString,
  currentAnchor: Schema.String,
  branchStartAnchor: Schema.String,
  rejoinAnchor: Schema.String,
});

export const AnswerTopic = Schema.Literals(["messi", "us-open", "other"]);
export type AnswerTopic = typeof AnswerTopic.Type;
export const AnswerConfidence = Schema.Literals(["low", "medium", "high"]);
export type AnswerConfidence = typeof AnswerConfidence.Type;

export class GroundingSource extends Schema.Class<GroundingSource>(
  "h3/GroundingSource",
)({
  title: Schema.NonEmptyString,
  url: Schema.URLFromString,
  publishedAt: Schema.NullOr(Schema.String),
}) {}

export class GroundedAnswerPlan extends Schema.Class<GroundedAnswerPlan>(
  "h3/GroundedAnswerPlan",
)({
  plannerVersion: Schema.Literal("grounded-answer/1"),
  canAnswer: Schema.Boolean,
  topic: AnswerTopic,
  confidence: AnswerConfidence,
  answer: Schema.String,
  ingress: Schema.String,
  egress: Schema.String,
  informationAsOf: Schema.NonEmptyString,
  sources: Schema.Array(GroundingSource),
}) {}
export const ShotInstruction = Schema.Struct({
  purpose: Schema.Literals(["answer-viewer-question", "canonical-segment"]),
  dialogue: Schema.String,
  framing: Schema.String,
  motion: Schema.String,
  audio: Schema.String,
  terminalState: Schema.String,
});

export class GenerationPlan extends Schema.Class<GenerationPlan>(
  "h3/GenerationPlan",
)({
  compilerVersion: Schema.Literals([
    "h3-compiler/1",
    "h3-compiler/2",
    "h3-compiler/3",
    "h3-compiler/4",
    "h3-compiler/5",
    "h3-sports-compiler/1",
  ]),
  clipId: ClipId,
  branchId: BranchId,
  durationSeconds: VideoDurationSeconds,
  seed: Schema.Int,
  providerModel: Schema.Literals([
    "minimax/h3-max/text-to-video",
    "minimax/h3-max/image-to-video",
  ]),
  continuityStartImageUrl: Schema.NullOr(Schema.URLFromString),
  continuityEndImageUrl: Schema.NullOr(Schema.URLFromString),
  packageBeats: Schema.Array(
    Schema.Literals(["canonical", "ingress", "answer", "egress"]),
  ),
  grounding: Schema.NullOr(GroundedAnswerPlan),
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

const FalHttpsMediaUrl = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      url.protocol === "https:" &&
      (url.hostname === "fal.media" || url.hostname.endsWith(".fal.media"))
        ? undefined
        : "Expected a fal CDN HTTPS media URL",
    { expected: "a fal CDN HTTPS media URL" },
  ),
);

const FalVideoWire = Schema.Struct({
  url: FalHttpsMediaUrl,
  content_type: Schema.optional(Schema.String),
  file_name: Schema.optional(Schema.String),
  file_size: Schema.optional(Schema.Int),
});
const FalSuccessPayloadWire = Schema.Struct({
  video: FalVideoWire,
  expanded_prompt: Schema.optional(Schema.NullOr(Schema.String)),
});
const FalWebhookEnvelopeWire = {
  request_id: Schema.NonEmptyString,
  gateway_request_id: Schema.optional(Schema.String),
} as const;

/** fal's JSON wire envelope. URL strings decode to URL values at this boundary. */
export const FalWebhookPayloadWire = Schema.Union([
  Schema.Struct({
    ...FalWebhookEnvelopeWire,
    status: Schema.Literal("OK"),
    payload: Schema.optional(Schema.NullOr(FalSuccessPayloadWire)),
    payload_error: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    ...FalWebhookEnvelopeWire,
    status: Schema.Literal("ERROR"),
    payload: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.String),
  }),
]);
export type FalWebhookPayload = typeof FalWebhookPayloadWire.Type;
export type FalWebhookPayloadEncoded = typeof FalWebhookPayloadWire.Encoded;

export const FalWebhookJsonWire = Schema.fromJsonString(FalWebhookPayloadWire);

export const decodeCreateSessionPayload =
  Schema.decodeUnknownEffect(CreateSessionPayload);
export const decodeViewerEventPayload =
  Schema.decodeUnknownEffect(ViewerEventPayload);
export const decodeBranchGenerationJob =
  Schema.decodeUnknownEffect(BranchGenerationJob);
export const encodeBranchGenerationJob =
  Schema.encodeEffect(BranchGenerationJob);
export const decodeFalWebhookPayload = Schema.decodeUnknownEffect(
  FalWebhookPayloadWire,
);

export class CanonicalCatalogClip extends Schema.Class<CanonicalCatalogClip>(
  "h3/CanonicalCatalogClip",
)({
  ordinal: Schema.Int,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  speaker: Schema.NonEmptyString,
  durationMs: Schema.Literal(5_000),
  artifactId: ArtifactId,
  anchor: Schema.NonEmptyString,
  manifestKey: Schema.NonEmptyString,
  continuityContractVersion: Schema.Literal("sports-news-continuity/1"),
}) {}

export class CompletedCanonicalBuild extends Schema.Class<CompletedCanonicalBuild>(
  "h3/CompletedCanonicalBuild",
)({
  generationJobId: Schema.NonEmptyString,
  providerRequestId: Schema.NonEmptyString,
  artifactId: ArtifactId,
}) {}

export class CanonicalPublicationClip extends Schema.Class<CanonicalPublicationClip>(
  "h3/CanonicalPublicationClip",
)({
  ordinal: Schema.Int,
  clipId: ClipId,
  title: Schema.NonEmptyString,
  speaker: Schema.NonEmptyString,
  anchor: Schema.NonEmptyString,
  artifactId: ArtifactId,
  manifestKey: Schema.NonEmptyString,
  providerRequestId: Schema.NonEmptyString,
  generationJobId: Schema.NonEmptyString,
  continuityInputKey: Schema.NonEmptyString,
  validationEvidenceJson: Schema.NonEmptyString,
}) {}

export class CanonicalPublication extends Schema.Class<CanonicalPublication>(
  "h3/CanonicalPublication",
)({
  episodeId: EpisodeId,
  showId: ShowId,
  showVersion: Schema.NonEmptyString,
  continuityContractVersion: Schema.Literal("sports-news-continuity/1"),
  continuityContractJson: Schema.NonEmptyString,
  publishedAt: Schema.NonEmptyString,
  clips: Schema.Array(CanonicalPublicationClip),
}) {}

export class CanonicalBuildPayload extends Schema.Class<CanonicalBuildPayload>(
  "h3/CanonicalBuildPayload",
)({
  slot: Schema.Literals([
    "messi-headline",
    "messi-context",
    "us-open-reentry",
    "us-open-continuation",
    "djokovic-upset-headline",
    "djokovic-upset-context",
    "alcaraz-return-headline",
    "alcaraz-return-context",
    "dutch-gp-headline",
    "dutch-gp-context",
  ]),
  attempt: Schema.Literals([1, 2]),
  continuityStartImageUrl: Schema.URLFromString,
}) {}

export const decodeCanonicalBuildPayload = Schema.decodeUnknownEffect(
  CanonicalBuildPayload,
);

export const decodeCanonicalCatalogClips = Schema.decodeUnknownEffect(
  Schema.Array(CanonicalCatalogClip),
);

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
