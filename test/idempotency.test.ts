import { env } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import {
  BranchGenerationJob,
  BranchId,
  ClipId,
  SessionId,
  StateVersion,
} from "../src/domain";
import { auditLedgerLive } from "../src/layers";
import { AuditLedger } from "../src/services";
import { compileGenerationPlan } from "../src/prompt-compiler";
import { SessionState } from "../src/domain";

beforeEach(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
      branch_id TEXT NOT NULL, clip_id TEXT NOT NULL, desired_ordinal INTEGER NOT NULL,
      state_version INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
      provider_request_id TEXT UNIQUE, prompt_compiler_version TEXT NOT NULL, artifact_id TEXT,
      error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      request_id TEXT PRIMARY KEY, signature_timestamp INTEGER NOT NULL, status TEXT NOT NULL, received_at TEXT NOT NULL
    )`,
  ).run();
});

describe("asynchronous delivery idempotency", () => {
  it("claims a duplicate queue job and webhook only once", async () => {
    const state = Schema.decodeUnknownSync(SessionState)({
      sessionId: "session-idempotency",
      showId: "signal-room",
      episodeId: "episode-001",
      showVersion: "v1",
      stateVersion: 1,
      canonicalPlayheadAnchor: "anchor-001",
      bufferDepthMs: 20_000,
      targetBufferMs: 20_000,
      branchPhase: "planned",
      branchId: "branch-idempotency",
      branchQuestion: "Question",
      rejoinAnchor: "anchor-005",
      branchArtifactId: null,
      playlistRevision: 1,
      deadlineAt: 9999999999999,
    });
    const branchId = Schema.decodeUnknownSync(BranchId)("branch-idempotency");
    const clipId = Schema.decodeUnknownSync(ClipId)("clip-idempotency");
    const plan = compileGenerationPlan({
      branchId,
      clipId,
      question: "Question",
      state,
      rejoinAnchor: "anchor-005",
    });
    const job = new BranchGenerationJob({
      jobId: "job-idempotency",
      idempotencyKey: "queue-idempotency",
      sessionId: Schema.decodeUnknownSync(SessionId)("session-idempotency"),
      branchId,
      clipId,
      desiredOrdinal: 11,
      stateVersion: Schema.decodeUnknownSync(StateVersion)(2),
      deadlineAt: 9999999999999,
      plan,
    });
    const program = AuditLedger.use((audit) =>
      Effect.all(
        {
          queueFirst: audit.ensureGeneration(
            job,
            "fake",
            "2026-08-31T00:00:00.000Z",
          ),
          queueDuplicate: audit.ensureGeneration(
            job,
            "fake",
            "2026-08-31T00:00:01.000Z",
          ),
          webhookFirst: audit.claimWebhook(
            "provider-request-1",
            1_788_000_000,
            "2026-08-31T00:00:02.000Z",
          ),
          webhookDuplicate: audit.claimWebhook(
            "provider-request-1",
            1_788_000_000,
            "2026-08-31T00:00:03.000Z",
          ),
          webhookRetryable: audit.settleWebhook(
            "provider-request-1",
            "RETRYABLE",
            "2026-08-31T00:00:04.000Z",
          ),
          webhookRetry: audit.claimWebhook(
            "provider-request-1",
            1_788_000_001,
            "2026-08-31T00:00:05.000Z",
          ),
          webhookCompleted: audit.settleWebhook(
            "provider-request-1",
            "COMPLETED",
            "2026-08-31T00:00:06.000Z",
          ),
          webhookAfterCompletion: audit.claimWebhook(
            "provider-request-1",
            1_788_000_002,
            "2026-08-31T00:00:07.000Z",
          ),
        },
        { concurrency: 1 },
      ),
    ).pipe(Effect.provide(auditLedgerLive(env.DB)));
    expect(await Effect.runPromise(program)).toEqual({
      queueFirst: true,
      queueDuplicate: false,
      webhookFirst: true,
      webhookDuplicate: false,
      webhookRetryable: undefined,
      webhookRetry: true,
      webhookCompleted: undefined,
      webhookAfterCompletion: false,
    });
  });
});
