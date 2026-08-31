import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BranchGenerationJob,
  BranchId,
  ClipId,
  SessionId,
  SessionState,
  StateVersion,
} from "../src/domain";
import {
  FAL_H3_MAX_COST_FIRST_PROFILE_V1,
  compileFalH3MaxRequest,
} from "../src/fal-provider";
import { generationProviderLive } from "../src/layers";
import { compileGenerationPlan } from "../src/prompt-compiler";
import { GenerationProvider, type AppConfig } from "../src/services";

function generationJob(): BranchGenerationJob {
  const branchId = Schema.decodeUnknownSync(BranchId)("branch-cost-profile");
  const clipId = Schema.decodeUnknownSync(ClipId)("clip-cost-profile");
  const state = Schema.decodeUnknownSync(SessionState)({
    sessionId: "session-cost-profile",
    showId: "signal-room",
    episodeId: "episode-001",
    showVersion: "v1",
    stateVersion: 1,
    canonicalPlayheadAnchor: "anchor-001",
    bufferDepthMs: 20_000,
    targetBufferMs: 20_000,
    branchPhase: "planned",
    branchId,
    branchQuestion: "Why does the buffer matter?",
    rejoinAnchor: "anchor-005",
    branchArtifactId: null,
    playlistRevision: 1,
    deadlineAt: 9_999_999_999_999,
  });
  return new BranchGenerationJob({
    jobId: "job-cost-profile",
    idempotencyKey: "queue-cost-profile",
    sessionId: Schema.decodeUnknownSync(SessionId)("session-cost-profile"),
    branchId,
    clipId,
    desiredOrdinal: 11,
    stateVersion: Schema.decodeUnknownSync(StateVersion)(2),
    deadlineAt: 9_999_999_999_999,
    plan: compileGenerationPlan({
      branchId,
      clipId,
      question: "Why does the buffer matter?",
      state,
      rejoinAnchor: "anchor-005",
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fal H3 Max cost-first request", () => {
  it("keeps the versioned profile at the lowest supported generation settings", () => {
    expect(FAL_H3_MAX_COST_FIRST_PROFILE_V1).toEqual({
      version: "h3-max-cost-first/1",
      durationSeconds: 5,
      resolution: "480P",
      promptExpansionMode: "balanced",
      aspectRatio: "16:9",
      safetyCheckerEnabled: true,
      syncModeEnabled: false,
    });
  });

  it("serializes the exact live provider body without sync or base64 output", async () => {
    const job = generationJob();
    const expectedBody = {
      prompt: job.plan.resolvedPrompt,
      duration: 5,
      resolution: "480P",
      seed: job.plan.seed,
      enable_safety_checker: true,
      prompt_expansion_mode: "balanced",
      aspect_ratio: "16:9",
    };
    let capturedUrl = "";
    let capturedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized JSON request body");
        capturedBody = JSON.parse(init.body);
        return Promise.resolve(
          Response.json({ request_id: "fal-request-cost-profile" }),
        );
      }),
    );
    const config: AppConfig["Service"] = {
      environment: "test",
      providerMode: "fal",
      publicBaseUrl: "https://prototype.example",
      falModel: "minimax/h3-max/text-to-video",
      falKey: "test-only-key",
    };

    const submission = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* GenerationProvider;
        return yield* provider.submit(job);
      }).pipe(Effect.provide(generationProviderLive(config))),
    );

    expect(capturedUrl).toBe(
      "https://queue.fal.run/minimax/h3-max/text-to-video?fal_webhook=https%3A%2F%2Fprototype.example%2Fv1%2Fwebhooks%2Ffal",
    );
    expect(capturedBody).toEqual(expectedBody);
    expect(capturedBody).not.toHaveProperty("sync_mode");
    expect(capturedBody).not.toHaveProperty("response_format");
    expect(compileFalH3MaxRequest(job.plan)).toEqual(expectedBody);
    expect(submission).toEqual({
      kind: "submitted",
      providerRequestId: "fal-request-cost-profile",
    });
  });
});
