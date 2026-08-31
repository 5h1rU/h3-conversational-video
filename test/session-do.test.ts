import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ArtifactId, BranchId } from "../src/domain";
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
    const playlist = await stub.getPlaylist();
    const sources = playlist.entries.map((clip) => clip.source);
    expect(sources.indexOf("branch")).toBeGreaterThan(-1);
    expect(sources.indexOf("reentry")).toBe(sources.indexOf("branch") + 1);
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
    expect(state.playlistRevision).toBe(1);
    expect(playlist.entries).toHaveLength(144);
    expect(playlist.entries.every((clip) => clip.source === "canonical")).toBe(
      true,
    );
  });
});
