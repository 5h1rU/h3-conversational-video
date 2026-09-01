import { env } from "cloudflare:workers";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalBuildIdempotencyKey,
  SPORTS_CANONICAL_SPECS,
  SPORTS_EPISODE_ID,
} from "../src/canonical-sports";
import { artifactStoreLive, canonicalCatalogLive } from "../src/layers";
import { CanonicalCatalog } from "../src/services";
import { publishSportsCanonical } from "../src/use-cases/publish-sports-canonical";

const jobs = SPORTS_CANONICAL_SPECS.map(
  (spec) =>
    [
      canonicalBuildIdempotencyKey(
        spec.slot,
        spec.slot === "messi-headline" ? 2 : 1,
      ),
      spec.clipId,
    ] as const,
);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL,
      branch_id TEXT NOT NULL, clip_id TEXT NOT NULL, desired_ordinal INTEGER NOT NULL,
      state_version INTEGER NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL,
      provider_request_id TEXT UNIQUE, prompt_compiler_version TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 5000, artifact_id TEXT,
      error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS canonical_episodes (
      episode_id TEXT PRIMARY KEY, show_id TEXT NOT NULL, show_version TEXT NOT NULL,
      status TEXT NOT NULL, continuity_contract_version TEXT NOT NULL,
      continuity_contract_json TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS canonical_clips (
      episode_id TEXT NOT NULL REFERENCES canonical_episodes(episode_id), ordinal INTEGER NOT NULL,
      clip_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, speaker TEXT NOT NULL, anchor TEXT NOT NULL,
      duration_ms INTEGER NOT NULL, artifact_id TEXT NOT NULL, manifest_key TEXT NOT NULL,
      provider_request_id TEXT NOT NULL, generation_job_id TEXT NOT NULL REFERENCES generation_jobs(id),
      prompt_compiler_version TEXT NOT NULL, continuity_contract_version TEXT NOT NULL,
      continuity_input_key TEXT NOT NULL, validation_status TEXT NOT NULL,
      validation_evidence_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (episode_id, ordinal)
    )`),
    env.DB.prepare("DELETE FROM canonical_clips"),
    env.DB.prepare("DELETE FROM canonical_episodes"),
    env.DB.prepare("DELETE FROM generation_jobs"),
  ]);
  for (const [index, [idempotencyKey, clipId]] of jobs.entries()) {
    const digest = String(index + 1).repeat(64);
    const artifactId = `sha256:${digest}`;
    const mediaKey = `artifacts/sha256/${digest}/clip.mp4`;
    const manifestKey = `artifacts/sha256/${digest}/manifest.v1.json`;
    const body = new Uint8Array(128).fill(index + 1);
    await env.MEDIA.put(mediaKey, body, {
      httpMetadata: { contentType: "video/mp4" },
    });
    await env.MEDIA.put(
      manifestKey,
      JSON.stringify({
        version: 1,
        artifactId,
        mediaKey,
        manifestKey,
        contentType: "video/mp4",
        size: body.byteLength,
        durationMs: 5_000,
      }),
    );
    await env.DB.prepare(
      `INSERT INTO generation_jobs
       (id, idempotency_key, session_id, branch_id, clip_id, desired_ordinal, state_version,
        status, provider, provider_request_id, prompt_compiler_version, artifact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 2, 'COMPLETED', 'fal', ?, 'h3-sports-compiler/1', ?, ?, ?)`,
    )
      .bind(
        `job-${index}`,
        idempotencyKey,
        `session-${index}`,
        `branch-${index}`,
        clipId,
        index * 10,
        `provider-${index}`,
        artifactId,
        "2026-08-31T00:00:00.000Z",
        "2026-08-31T00:00:00.000Z",
      )
      .run();
  }
});

describe("canonical episode publication", () => {
  it("validates ten committed artifacts and publishes the reusable catalog atomically", async () => {
    const program = publishSportsCanonical("2026-08-31T21:00:00.000Z").pipe(
      Effect.provide(canonicalCatalogLive(env.DB)),
      Effect.provide(artifactStoreLive(env.MEDIA)),
    );
    await expect(Effect.runPromise(program)).resolves.toEqual({
      published: true,
      clipCount: 10,
    });
    await expect(Effect.runPromise(program)).resolves.toEqual({
      published: true,
      clipCount: 10,
    });
    const clips = await Effect.runPromise(
      CanonicalCatalog.use((catalog) =>
        catalog.loadPublished(SPORTS_EPISODE_ID),
      ).pipe(Effect.provide(canonicalCatalogLive(env.DB))),
    );
    expect(clips.map((clip) => clip.id)).toEqual(jobs.map((job) => job[1]));
  });

  it("never projects approved clip rows from an unpublished episode", async () => {
    await env.DB.prepare(
      `INSERT INTO canonical_episodes
       (episode_id, show_id, show_version, status, continuity_contract_version,
        continuity_contract_json, created_at, published_at)
       VALUES ('building-episode', 'signal-room-sports', 'v1', 'BUILDING',
        'sports-news-continuity/1', '{}', '2026-08-31T00:00:00.000Z', NULL)`,
    ).run();
    const clips = await Effect.runPromise(
      CanonicalCatalog.use((catalog) =>
        catalog.loadPublished("building-episode"),
      ).pipe(Effect.provide(canonicalCatalogLive(env.DB))),
    );
    expect(clips).toEqual([]);
  });
});
