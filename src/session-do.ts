import { DurableObject } from "cloudflare:workers";
import { Clock, Effect, Schema } from "effect";
import {
  ArtifactId,
  EventId,
  decodeCanonicalBuildPayload,
  decodeCreateSessionPayload,
  decodeSessionState,
  decodeViewerEventPayload,
  encodeSessionState,
  type BranchId,
  type SessionState,
  type SessionStateEncoded,
  ViewerEventPayload,
} from "./domain";
import { compileCanonicalSportsPlan } from "./canonical-sports";
import {
  generationQueueLive,
  idGeneratorLive,
  migrateSessionStorage,
  sessionRepositoryLive,
} from "./layers";
import {
  GenerationQueue,
  IdGenerator,
  SessionRepository,
  type CommittedArtifact,
} from "./services";
import { acceptViewerIntent } from "./use-cases/accept-viewer-intent";
import { createSession } from "./use-cases/create-session";

export class SessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() =>
      Promise.resolve(migrateSessionStorage(ctx)),
    );
  }

  private repositoryLayer() {
    return sessionRepositoryLive(this.ctx);
  }

  private broadcast(type: string, state: SessionState): void {
    const payload = JSON.stringify({ type, state });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (cause) {
        console.warn(
          JSON.stringify({
            event: "websocket.send.failed",
            error: String(cause),
          }),
        );
      }
    }
  }

  async initialize(payload: unknown): Promise<SessionStateEncoded> {
    const program = Effect.gen(function* () {
      const decoded = yield* decodeCreateSessionPayload(payload);
      return yield* createSession(decoded);
    }).pipe(
      Effect.provide(this.repositoryLayer()),
      Effect.provide(idGeneratorLive),
    );
    return encodeSessionState(await Effect.runPromise(program));
  }

  async acceptEvent(payload: unknown): Promise<{
    readonly accepted: boolean;
    readonly duplicate: boolean;
    readonly state: SessionStateEncoded;
    readonly error?: { readonly code: "BRANCH_BUSY"; readonly message: string };
    readonly event: {
      readonly eventId: import("./domain").EventId;
      readonly text: string;
      readonly playbackPositionMs: number;
    };
  }> {
    const publicBaseUrl = this.env.PUBLIC_BASE_URL;
    const program = Effect.gen(function* () {
      const decoded = yield* decodeViewerEventPayload(payload);
      const outcome = yield* acceptViewerIntent(decoded, publicBaseUrl).pipe(
        Effect.map((reserved) => ({ kind: "accepted" as const, reserved })),
        Effect.catchTag("BranchBusy", (error) =>
          SessionRepository.use((repository) => repository.read()).pipe(
            Effect.map((state) => ({ kind: "busy" as const, error, state })),
          ),
        ),
      );
      return { decoded, outcome };
    }).pipe(
      Effect.provide(this.repositoryLayer()),
      Effect.provide(generationQueueLive(this.env.BRANCH_GENERATION)),
      Effect.provide(idGeneratorLive),
    );
    const result = await Effect.runPromise(program);
    if (result.outcome.kind === "busy") {
      return {
        accepted: false,
        duplicate: false,
        state: encodeSessionState(result.outcome.state),
        error: { code: "BRANCH_BUSY", message: result.outcome.error.message },
        event: {
          eventId: result.decoded.eventId,
          text: result.decoded.text,
          playbackPositionMs: result.decoded.playbackPositionMs,
        },
      };
    }
    this.broadcast("branch.status", result.outcome.reserved.state);
    if (result.outcome.reserved.job !== null)
      await this.ctx.storage.setAlarm(result.outcome.reserved.job.deadlineAt);
    return {
      accepted: true,
      duplicate: result.outcome.reserved.duplicate,
      state: encodeSessionState(result.outcome.reserved.state),
      event: {
        eventId: result.decoded.eventId,
        text: result.decoded.text,
        playbackPositionMs: result.decoded.playbackPositionMs,
      },
    };
  }

  async buildCanonicalClip(payload: unknown): Promise<{
    readonly duplicate: boolean;
    readonly state: SessionStateEncoded;
    readonly queued: boolean;
  }> {
    const program = Effect.gen(function* () {
      const decoded = yield* decodeCanonicalBuildPayload(payload);
      const repository = yield* SessionRepository;
      const queue = yield* GenerationQueue;
      const ids = yield* IdGenerator;
      const state = yield* repository.read();
      const now = yield* Clock.currentTimeMillis;
      const plan = compileCanonicalSportsPlan(decoded);
      const event = new ViewerEventPayload({
        eventId: Schema.decodeUnknownSync(EventId)(
          `canonical-event-${decoded.slot}-${decoded.attempt}`,
        ),
        text: `canonical:${decoded.slot}`,
        playbackPositionMs: 0,
        playlistRevision: state.playlistRevision,
      });
      const reserved = yield* repository.reserveBranch({
        event,
        branchId: plan.branchId,
        clipId: plan.clipId,
        jobId: yield* ids.next,
        idempotencyKey:
          decoded.attempt === 1
            ? `canonical:${decoded.slot}:v1`
            : `canonical:${decoded.slot}:v1:retry:2`,
        deadlineAt: now + 15 * 60_000,
        plan,
      });
      if (reserved.job !== null) yield* queue.send(reserved.job);
      return reserved;
    }).pipe(
      Effect.provide(this.repositoryLayer()),
      Effect.provide(generationQueueLive(this.env.BRANCH_GENERATION)),
      Effect.provide(idGeneratorLive),
    );
    const reserved = await Effect.runPromise(program);
    if (reserved.job !== null)
      await this.ctx.storage.setAlarm(reserved.job.deadlineAt);
    return {
      duplicate: reserved.duplicate,
      state: encodeSessionState(reserved.state),
      queued: reserved.job !== null,
    };
  }

  async getState(): Promise<SessionStateEncoded> {
    const state = await Effect.runPromise(
      SessionRepository.use((repository) => repository.read()).pipe(
        Effect.provide(this.repositoryLayer()),
      ),
    );
    return encodeSessionState(state);
  }

  async placeBranch(
    branchId: BranchId,
    branchStartAnchor: string,
    rejoinAnchor: string,
  ): Promise<SessionStateEncoded> {
    const state = await Effect.runPromise(
      SessionRepository.use((repository) =>
        repository.placeBranch({
          branchId,
          branchStartAnchor,
          rejoinAnchor,
        }),
      ).pipe(Effect.provide(this.repositoryLayer())),
    );
    this.broadcast("branch.placed", state);
    return encodeSessionState(state);
  }

  async getPlaylist() {
    const entries = await Effect.runPromise(
      SessionRepository.use((repository) => repository.playlist()).pipe(
        Effect.provide(this.repositoryLayer()),
      ),
    );
    const state = await this.getState();
    return { revision: state.playlistRevision, entries };
  }

  async ownsArtifact(artifactId: string): Promise<boolean> {
    return Effect.runPromise(
      SessionRepository.use((repository) =>
        repository.ownsArtifact(
          Schema.decodeUnknownSync(ArtifactId)(artifactId),
        ),
      ).pipe(
        Effect.catchTag("StorageError", () => Effect.succeed(false)),
        Effect.provide(this.repositoryLayer()),
      ),
    );
  }

  async canAcceptResult(branchId: BranchId): Promise<boolean> {
    return Effect.runPromise(
      SessionRepository.use((repository) => repository.read()).pipe(
        Effect.map(
          (state) =>
            state.branchId === branchId &&
            (state.branchPhase === "planned" ||
              state.branchPhase === "generating") &&
            state.deadlineAt !== null &&
            state.deadlineAt > Date.now(),
        ),
        Effect.provide(this.repositoryLayer()),
      ),
    );
  }

  async markGenerating(branchId: BranchId): Promise<SessionStateEncoded> {
    const state = await Effect.runPromise(
      SessionRepository.use((repository) =>
        repository.markGenerating(branchId),
      ).pipe(Effect.provide(this.repositoryLayer())),
    );
    this.broadcast("branch.status", state);
    return encodeSessionState(state);
  }

  async publishBranch(
    branchId: BranchId,
    artifact: CommittedArtifact,
  ): Promise<SessionStateEncoded> {
    const state = await Effect.runPromise(
      SessionRepository.use((repository) =>
        repository.publishBranch({ branchId, artifact }),
      ).pipe(Effect.provide(this.repositoryLayer())),
    );
    await this.ctx.storage.deleteAlarm();
    this.broadcast("playlist.revised", state);
    return encodeSessionState(state);
  }

  async failBranch(
    branchId: BranchId,
    reason: string,
  ): Promise<SessionStateEncoded> {
    const state = await Effect.runPromise(
      SessionRepository.use((repository) =>
        repository.failBranch(branchId, reason),
      ).pipe(Effect.provide(this.repositoryLayer())),
    );
    await this.ctx.storage.deleteAlarm();
    this.broadcast("branch.status", state);
    return encodeSessionState(state);
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket")
      return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ connectedAt: Date.now() });
    server.send(
      JSON.stringify({ type: "session.state", state: await this.getState() }),
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): void {
    if (typeof message === "string" && message === "ping") socket.send("pong");
  }

  override webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): void {
    socket.close(code, reason);
  }

  override async alarm(): Promise<void> {
    const state = decodeSessionState(await this.getState());
    if (
      state.branchId !== null &&
      state.deadlineAt !== null &&
      state.deadlineAt <= Date.now() &&
      ["planned", "generating"].includes(state.branchPhase)
    ) {
      await this.failBranch(state.branchId, "GENERATION_DEADLINE_EXCEEDED");
    }
  }
}
