import { Context, Effect, Schema } from "effect";
import type {
  ArtifactId,
  BranchGenerationJob,
  BranchId,
  ClipId,
  ClipQueueEntry,
  CanonicalPublication,
  CompletedCanonicalBuild,
  EventId,
  GenerationPlan,
  GroundedAnswerPlan,
  MediaDurationMs,
  CanonicalCatalogClip,
  SessionId,
  SessionState,
  ShowId,
  StateVersion,
  ViewerEventPayload,
} from "./domain";

export class InputError extends Schema.TaggedError<InputError>()("InputError", {
  message: Schema.String,
}) {}
export class SessionNotInitialized extends Schema.TaggedError<SessionNotInitialized>()(
  "SessionNotInitialized",
  { message: Schema.String },
) {}
export class BranchBusy extends Schema.TaggedError<BranchBusy>()("BranchBusy", {
  branchId: Schema.String,
  message: Schema.String,
}) {}
export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}
export class ProviderError extends Schema.TaggedError<ProviderError>()(
  "ProviderError",
  {
    operation: Schema.String,
    code: Schema.String,
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}
export class AnswerPlanningError extends Schema.TaggedError<AnswerPlanningError>()(
  "AnswerPlanningError",
  {
    code: Schema.Literals([
      "ANSWER_GATEWAY_FAILED",
      "ANSWER_PAYLOAD_INVALID",
      "ANSWER_NOT_GROUNDED",
    ]),
    message: Schema.String,
    retryable: Schema.Boolean,
  },
) {}
export class ArtifactValidationError extends Schema.TaggedError<ArtifactValidationError>()(
  "ArtifactValidationError",
  { message: Schema.String },
) {}
export class WebhookAuthorizationError extends Schema.TaggedError<WebhookAuthorizationError>()(
  "WebhookAuthorizationError",
  { message: Schema.String },
) {}
export class ProviderPayloadError extends Schema.TaggedError<ProviderPayloadError>()(
  "ProviderPayloadError",
  {
    code: Schema.Literal("FAL_WEBHOOK_PAYLOAD_INVALID"),
    message: Schema.String,
  },
) {}
export class StaleGenerationError extends Schema.TaggedError<StaleGenerationError>()(
  "StaleGenerationError",
  { message: Schema.String },
) {}

export interface SessionInitialization {
  readonly sessionId: SessionId;
  readonly showId: ShowId;
  readonly episodeId: string;
  readonly showVersion: string;
  readonly now: number;
  readonly canonicalEntries: ReadonlyArray<ClipQueueEntry>;
}

export interface ReservedBranch {
  readonly duplicate: boolean;
  readonly state: SessionState;
  readonly job: BranchGenerationJob | null;
}

export interface ArtifactCommitInput {
  readonly clipId: ClipId;
  readonly branchId: BranchId;
  readonly body: Uint8Array;
  readonly contentType: "video/mp4" | "image/svg+xml";
  readonly durationMs: MediaDurationMs;
  readonly providerRequestId: string;
  readonly promptCompilerVersion:
    | "h3-compiler/1"
    | "h3-compiler/2"
    | "h3-compiler/3"
    | "h3-compiler/4"
    | "h3-compiler/5"
    | "h3-sports-compiler/1";
}

export interface CommittedArtifact {
  readonly artifactId: ArtifactId;
  readonly mediaKey: string;
  readonly manifestKey: string;
  readonly contentType: string;
  readonly size: number;
  readonly durationMs: MediaDurationMs;
}

export type ProviderSubmission =
  | {
      readonly kind: "completed";
      readonly providerRequestId: string;
      readonly artifact: ArtifactCommitInput;
    }
  | { readonly kind: "submitted"; readonly providerRequestId: string };

export class SessionRepository extends Context.Service<
  SessionRepository,
  {
    initialize(
      input: SessionInitialization,
    ): Effect.Effect<SessionState, StorageError>;
    read(): Effect.Effect<SessionState, SessionNotInitialized | StorageError>;
    reserveBranch(input: {
      readonly event: ViewerEventPayload;
      readonly branchId: BranchId;
      readonly clipId: ClipId;
      readonly jobId: string;
      readonly idempotencyKey: string;
      readonly deadlineAt: number;
      readonly plan: GenerationPlan;
    }): Effect.Effect<
      ReservedBranch,
      BranchBusy | SessionNotInitialized | StorageError
    >;
    markGenerating(
      branchId: BranchId,
    ): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    placeBranch(input: {
      readonly branchId: BranchId;
      readonly branchStartAnchor: string;
      readonly rejoinAnchor: string;
    }): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    publishBranch(input: {
      readonly branchId: BranchId;
      readonly artifact: CommittedArtifact;
    }): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    failBranch(
      branchId: BranchId,
      reason: string,
    ): Effect.Effect<SessionState, StorageError>;
    playlist(): Effect.Effect<
      ReadonlyArray<ClipQueueEntry>,
      SessionNotInitialized | StorageError
    >;
    ownsArtifact(artifactId: ArtifactId): Effect.Effect<boolean, StorageError>;
  }
>()("h3/services/SessionRepository") {}

export class GenerationQueue extends Context.Service<
  GenerationQueue,
  {
    send(job: BranchGenerationJob): Effect.Effect<void, StorageError>;
  }
>()("h3/services/GenerationQueue") {}

export class GenerationProvider extends Context.Service<
  GenerationProvider,
  {
    submit(
      job: BranchGenerationJob,
    ): Effect.Effect<ProviderSubmission, ProviderError>;
    fetchResult(input: {
      readonly url: URL;
      readonly clipId: ClipId;
      readonly branchId: BranchId;
      readonly providerRequestId: string;
      readonly promptCompilerVersion:
        | "h3-compiler/1"
        | "h3-compiler/2"
        | "h3-compiler/3"
        | "h3-compiler/4"
        | "h3-compiler/5"
        | "h3-sports-compiler/1";
      readonly durationMs: MediaDurationMs;
    }): Effect.Effect<ArtifactCommitInput, ProviderError>;
  }
>()("h3/services/GenerationProvider") {}

export interface AnswerPlanningInput {
  readonly question: string;
  readonly episodeId: string;
  readonly currentAnchor: string;
  readonly requestedAt: string;
}

export interface AnswerPlanningResult {
  readonly plan: GroundedAnswerPlan;
  readonly provider: "moonshot" | "fake";
  readonly model: string;
  readonly gatewayLogId: string | null;
}

export class AnswerPlanner extends Context.Service<
  AnswerPlanner,
  {
    plan(
      input: AnswerPlanningInput,
    ): Effect.Effect<AnswerPlanningResult, AnswerPlanningError>;
  }
>()("h3/services/AnswerPlanner") {}

export class AnswerPlanLedger extends Context.Service<
  AnswerPlanLedger,
  {
    record(input: {
      readonly generationJobId: string;
      readonly provider: string;
      readonly model: string;
      readonly plan: GroundedAnswerPlan;
      readonly gatewayLogId: string | null;
      readonly resolvedPromptCompilerVersion: "h3-compiler/5" | null;
      readonly desiredOrdinal: number | null;
      readonly at: string;
    }): Effect.Effect<void, StorageError>;
  }
>()("h3/services/AnswerPlanLedger") {}

export class SessionPublisher extends Context.Service<
  SessionPublisher,
  {
    canAccept(
      sessionId: SessionId,
      branchId: BranchId,
    ): Effect.Effect<boolean, StorageError>;
    markGenerating(
      sessionId: SessionId,
      branchId: BranchId,
    ): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    place(input: {
      readonly sessionId: SessionId;
      readonly branchId: BranchId;
      readonly branchStartAnchor: string;
      readonly rejoinAnchor: string;
    }): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    publish(
      sessionId: SessionId,
      branchId: BranchId,
      artifact: CommittedArtifact,
    ): Effect.Effect<SessionState, StaleGenerationError | StorageError>;
    fail(
      sessionId: SessionId,
      branchId: BranchId,
      reason: string,
    ): Effect.Effect<SessionState, StorageError>;
  }
>()("h3/services/SessionPublisher") {}

export class ArtifactStore extends Context.Service<
  ArtifactStore,
  {
    validateAndCommit(
      input: ArtifactCommitInput,
    ): Effect.Effect<CommittedArtifact, ArtifactValidationError | StorageError>;
    inspectCommitted(
      artifactId: ArtifactId,
    ): Effect.Effect<CommittedArtifact, ArtifactValidationError | StorageError>;
  }
>()("h3/services/ArtifactStore") {}

export class AuditLedger extends Context.Service<
  AuditLedger,
  {
    recordSession(input: {
      readonly sessionId: SessionId;
      readonly showId: ShowId;
      readonly episodeId: string;
      readonly showVersion: string;
      readonly at: string;
    }): Effect.Effect<void, StorageError>;
    recordViewerEvent(input: {
      readonly eventId: EventId;
      readonly sessionId: SessionId;
      readonly transcript: string;
      readonly playbackMs: number;
      readonly at: string;
    }): Effect.Effect<void, StorageError>;
    ensureGeneration(
      job: BranchGenerationJob,
      provider: string,
      at: string,
    ): Effect.Effect<boolean, StorageError>;
    markProviderSubmitted(
      job: BranchGenerationJob,
      requestId: string,
      at: string,
    ): Effect.Effect<void, StorageError>;
    findJobByProviderRequest(requestId: string): Effect.Effect<
      {
        readonly jobId: string;
        readonly sessionId: SessionId;
        readonly branchId: BranchId;
        readonly clipId: ClipId;
        readonly stateVersion: StateVersion;
        readonly promptCompilerVersion:
          | "h3-compiler/1"
          | "h3-compiler/2"
          | "h3-compiler/3"
          | "h3-compiler/4"
          | "h3-compiler/5"
          | "h3-sports-compiler/1";
        readonly durationMs: MediaDurationMs;
      } | null,
      StorageError
    >;
    markCompleted(
      jobId: string,
      artifactId: ArtifactId,
      at: string,
    ): Effect.Effect<void, StorageError>;
    markFailed(
      jobId: string,
      code: string,
      at: string,
    ): Effect.Effect<void, StorageError>;
    claimWebhook(
      requestId: string,
      signatureTimestamp: number,
      at: string,
    ): Effect.Effect<boolean, StorageError>;
    settleWebhook(
      requestId: string,
      status: "COMPLETED" | "RETRYABLE",
      at: string,
    ): Effect.Effect<void, StorageError>;
  }
>()("h3/services/AuditLedger") {}

export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly environment: string;
    readonly providerMode: "fake" | "fal";
    readonly publicBaseUrl: string;
    readonly falModel: string;
    readonly falKey: string | undefined;
    readonly canonicalAdminToken: string | undefined;
    readonly answerPlannerMode: "fake" | "moonshot-web-search";
    readonly answerPlannerModel: string;
    readonly moonshotApiKey: string | undefined;
  }
>()("h3/services/AppConfig") {}

export class CanonicalCatalog extends Context.Service<
  CanonicalCatalog,
  {
    loadPublished(
      episodeId: string,
    ): Effect.Effect<ReadonlyArray<CanonicalCatalogClip>, StorageError>;
    findCompletedBuild(
      idempotencyKey: string,
    ): Effect.Effect<CompletedCanonicalBuild | null, StorageError>;
    publish(
      publication: CanonicalPublication,
    ): Effect.Effect<
      { readonly published: boolean; readonly clipCount: number },
      StorageError
    >;
  }
>()("h3/services/CanonicalCatalog") {}

export class IdGenerator extends Context.Service<
  IdGenerator,
  {
    readonly next: Effect.Effect<string>;
  }
>()("h3/services/IdGenerator") {}
