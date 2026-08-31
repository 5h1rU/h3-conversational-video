import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ArtifactId,
  BRANCH_GENERATION_DEADLINE_MS,
  BranchId,
} from "../src/domain";
import type { SessionDurableObject } from "../src/session-do";

function event(eventId: string, playbackPositionMs = 10_000) {
  return {
    eventId,
    text: "What does this mean for ordinary people?",
    playbackPositionMs,
    playlistRevision: 1,
  };
}

describe("Session Durable Object ordering authority", () => {
  it("reuses the four canonical sports artifacts and atomically inserts one combined branch package", async () => {
    const sessionId = "sports-session-ordering";
    const canonicalEntries = Array.from({ length: 4 }, (_, index) => ({
      ordinal: index * 10,
      id: `sports-canonical-${index}`,
      source: "canonical" as const,
      title: `Sports segment ${index + 1}`,
      speaker: index % 2 === 0 ? "Mara Vale" : "Theo Reyes",
      durationMs: 5_000,
      mediaUrl: `/v1/sessions/${sessionId}/media/sha256:${String(index).repeat(64)}`,
      anchor: `anchor-00${index}`,
      committed: true as const,
    }));
    const stub = env.SESSIONS.getByName(sessionId);
    await stub.initialize({
      sessionId,
      showId: "signal-room-sports",
      episodeId: "sports-news-2026-08-31",
      showVersion: "2026-08-31.sports.v1",
      canonicalEntries,
    });
    expect((await stub.getPlaylist()).entries).toEqual(canonicalEntries);

    const accepted = await stub.acceptEvent({
      ...event("sports-event-0001", 5_000),
      text: "What made Messi's international career distinctive?",
    });
    const branchId = accepted.state.branchId;
    if (branchId === null) throw new Error("branch id missing");
    const decodedBranchId = Schema.decodeUnknownSync(BranchId)(branchId);
    const artifact = {
      artifactId: Schema.decodeUnknownSync(ArtifactId)(
        `sha256:${"f".repeat(64)}`,
      ),
      mediaKey: `artifacts/sha256/${"f".repeat(64)}/clip.mp4`,
      manifestKey: `artifacts/sha256/${"f".repeat(64)}/manifest.v1.json`,
      contentType: "video/mp4",
      size: 1024,
      durationMs: 5_000 as const,
    };
    await stub.markGenerating(decodedBranchId);
    await stub.publishBranch(decodedBranchId, artifact);

    const playlist = await stub.getPlaylist();
    expect(playlist.revision).toBe(2);
    expect(playlist.entries.map((clip) => clip.id)).toEqual([
      "sports-canonical-0",
      "sports-canonical-1",
      `branch-${branchId}`,
      "sports-canonical-2",
      "sports-canonical-3",
    ]);
    expect(playlist.entries.map((clip) => clip.source)).toEqual([
      "canonical",
      "canonical",
      "branch",
      "canonical",
      "canonical",
    ]);
    expect(
      await stub.ownsArtifact(
        canonicalEntries[0]!.mediaUrl.split("/media/")[1]!,
      ),
    ).toBe(true);

    await runInDurableObject<SessionDurableObject, void>(
      stub,
      (_instance, state) => {
        const stored = state.storage.sql
          .exec<{ package_json: string }>(
            "SELECT package_json FROM branch_packages",
          )
          .one();
        expect(JSON.parse(stored.package_json)).toMatchObject({
          version: "branch-package/1",
          entries: [
            {
              beatKinds: ["ingress", "answer", "egress"],
            },
          ],
          rejoinAnchor: "anchor-002",
        });
      },
    );
  });

  it("enforces one branch, deduplicates viewer events, commits one playlist revision, and survives eviction", async () => {
    const stub = env.SESSIONS.getByName("session-ordering");
    await stub.initialize({
      sessionId: "session-ordering",
      showId: "signal-room",
      episodeId: "episode-001",
    });

    const accepted = await stub.acceptEvent(event("event-ordering-0001"));
    expect(accepted.duplicate).toBe(false);
    expect(accepted.state.branchPhase).toBe("planned");
    expect(accepted.state.playlistRevision).toBe(1);
    expect(accepted.state.deadlineAt).not.toBeNull();
    expect(BRANCH_GENERATION_DEADLINE_MS).toBe(25_000);

    const duplicate = await stub.acceptEvent(event("event-ordering-0001"));
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.state.stateVersion).toBe(accepted.state.stateVersion);

    const busy = await stub.acceptEvent(event("event-ordering-0002"));
    expect(busy.accepted).toBe(false);
    expect(busy.error?.code).toBe("BRANCH_BUSY");

    const branchId = accepted.state.branchId;
    expect(branchId).not.toBeNull();
    if (branchId === null) throw new Error("branch id missing");
    const decodedBranchId = Schema.decodeUnknownSync(BranchId)(branchId);
    expect(await stub.canAcceptResult(decodedBranchId)).toBe(true);
    await stub.markGenerating(decodedBranchId);
    const artifact = {
      artifactId: Schema.decodeUnknownSync(ArtifactId)(
        `sha256:${"a".repeat(64)}`,
      ),
      mediaKey: `artifacts/sha256/${"a".repeat(64)}/clip.svg`,
      manifestKey: `artifacts/sha256/${"a".repeat(64)}/manifest.v1.json`,
      contentType: "image/svg+xml",
      size: 512,
      durationMs: 5_000 as const,
    };
    const published = await stub.publishBranch(decodedBranchId, artifact);
    expect(published.playlistRevision).toBe(2);
    expect(published.branchPhase).toBe("ready");
    expect(await stub.canAcceptResult(decodedBranchId)).toBe(false);
    const playlist = await stub.getPlaylist();
    const sources = playlist.entries.map((clip) => clip.source);
    const branchIndex = sources.indexOf("branch");
    expect(branchIndex).toBeGreaterThan(-1);
    expect(sources).not.toContain("reentry");
    expect(sources[branchIndex + 1]).toBe("canonical");
    expect(playlist.entries.every((clip) => clip.committed)).toBe(true);
    expect(await stub.ownsArtifact(artifact.artifactId)).toBe(true);
    expect(
      await env.SESSIONS.getByName("uninitialized-session").ownsArtifact(
        artifact.artifactId,
      ),
    ).toBe(false);

    await runInDurableObject<SessionDurableObject, void>(
      stub,
      (_instance, state) => {
        const rows = state.storage.sql
          .exec<{ state_json: string }>("SELECT state_json FROM session_state")
          .toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.state_json).toContain('"playlistRevision":2');
      },
    );
    await evictDurableObject(stub);
    expect((await stub.getState()).playlistRevision).toBe(2);
  });

  it("keeps canonical playback unchanged when generation fails", async () => {
    const stub = env.SESSIONS.getByName("session-fallback");
    await stub.initialize({ sessionId: "session-fallback" });
    const accepted = await stub.acceptEvent(event("event-fallback-0001"));
    const branchId = accepted.state.branchId;
    if (branchId === null) throw new Error("branch id missing");
    await stub.failBranch(
      Schema.decodeUnknownSync(BranchId)(branchId),
      "PROVIDER_TIMEOUT",
    );
    const state = await stub.getState();
    const playlist = await stub.getPlaylist();
    expect(state.branchPhase).toBe("failed");
    expect(
      await stub.canAcceptResult(Schema.decodeUnknownSync(BranchId)(branchId)),
    ).toBe(false);
    expect(state.playlistRevision).toBe(1);
    expect(playlist.entries).toHaveLength(144);
    expect(playlist.entries.every((clip) => clip.source === "canonical")).toBe(
      true,
    );
  });
});
