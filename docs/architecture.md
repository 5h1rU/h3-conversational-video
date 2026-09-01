# Architecture boundaries

## Application flow

```text
HTTP typed event
  -> Worker adapter
  -> Session Durable Object RPC
  -> Effect acceptViewerIntent / planBranch
  -> native DO SQLite transaction (reserve + idempotency)
  -> Queue encoded job
  -> Effect submitGeneration
  -> Effect groundBranch -> AI Gateway / Sonar search
  -> D1 answer-plan audit + Session DO semantic placement
  -> fake or fal provider
  -> validateCommitArtifact (R2 media + immutable manifest)
  -> publishTimeline
  -> native DO compare/current-branch check + revision commit
  -> WebSocket control event / playlist polling
```

For the sports episode, a separate admin-only build path compiles four immutable canonical specifications and submits them sequentially. The canonical catalog is reusable across viewers:

```text
visual-bible first frame
  -> Messi headline -> validated endpoint frame
  -> Messi context  -> validated endpoint frame
  -> US Open re-entry -> validated endpoint frame
  -> US Open continuation
  -> continuity review -> atomic D1 episode publication
  -> session snapshot -> canonical -> optional branch package -> canonical
```

Partial builds remain quarantined. A session never observes a partly approved canonical episode.

Publication is an explicit Effect use case: it resolves the four expected completed builds, revalidates every immutable R2 manifest/media pair, and commits the episode plus ordered clip catalog in one D1 `batch()`. The read path joins only `PUBLISHED` episodes, so even a failed or interrupted publication cannot leak partial catalog rows into new sessions.

Queue delivery and provider completion may happen more than once or out of order. D1 claims external work once, while the Durable Object independently rejects any result that no longer matches its active branch. This two-boundary check prevents both avoidable duplicate provider submissions and duplicate playlist publication.

## Swappable pieces

| Contract              | Live implementation                            | Replacement examples                         |
| --------------------- | ---------------------------------------------- | -------------------------------------------- |
| `GenerationProvider`  | deterministic fake or fal H3 Max queue adapter | another video model, self-hosted H3          |
| `ArtifactStore`       | R2 content-addressed commit                    | R2 + containerized normalizer/CMAF packager  |
| `AuditLedger`         | D1                                             | another cross-session analytics/ledger store |
| clip queue projection | JSON committed clip queue                      | dynamic HLS/CMAF manifest adapter            |
| `AnswerPlanner`       | Perplexity Sonar through AI Gateway            | another grounded model, sports-data adapter  |
| Effect service layers | live Cloudflare bindings                       | deterministic test layers                    |

`src/services.ts` contains contracts and tagged errors. `src/layers.ts` contains live adapter layers. `src/use-cases/` contains named orchestration. `src/domain.ts` is the single schema and branded-ID boundary. `src/index.ts` and `src/session-do.ts` are delivery adapters/public facade.

`src/fal-provider.ts` is the replaceable provider request boundary. Its schema-checked `h3-max-cost-first/1` profile keeps reusable canonical clips at five seconds, while `h3-max-conversational-branch/2` uses H3 Max's supported 15-second maximum for personalized answers. Both remain `480P`, balanced prompt expansion, and safety checked. Image-to-video requests use the input image's aspect ratio per fal's contract. Sync/base64 response modes are intentionally absent so live work stays on the asynchronous queue/webhook path. Pricing is deliberately not part of this runtime contract because fal rates are volatile and must be checked before paid tests.

`src/canonical-sports.ts` owns the versioned sports content and `sports-news-continuity/1` contract. It fixes all audiovisual invariants and compiles four per-clip specifications without exposing episode orchestration to fal. D1 owns canonical build/audit records and approval evidence; R2 owns immutable continuity images and media manifests; the Session Durable Object snapshots only an approved episode and remains the sole live ordering authority.

`src/answer-planner.ts` is the external search-model wire boundary. It sends one low-context `perplexity/sonar` request through the native Workers AI binding and AI Gateway, then decodes the provider envelope and its structured JSON content separately. The question is explicitly delimited as untrusted data. Only HTTPS URLs corroborated by the provider's top-level `search_results` are admitted as evidence; model-authored URLs are never accepted on their own. `groundBranch` records the plan and AI Gateway log ID in D1, selects the episode's adjacent semantic anchors, atomically updates the still-current planned branch in the Session Durable Object, and only then allows fal submission. An ungrounded result is terminal for that branch and preserves canonical playback without video-provider spend.

`src/domain.ts` separately models fal's encoded webhook envelope and its decoded provider data. The wire codec validates the JSON string in `payload.video.url`, transforms it to an HTTPS `URL`, and preserves documented nullable fields such as `expanded_prompt`. Signature verification runs over the raw bytes before this decode. JWKS are cached for normal delivery, while a signature miss triggers one fresh fetch and verification attempt to tolerate provider key rotation without weakening authentication. A claimed delivery moves from `PROCESSING` to `COMPLETED`; transient downstream failures mark it `RETRYABLE`, and an abandoned processing lease can be reclaimed after two minutes. Media fetches use manual redirects and reject every redirect. The longer branch has a two-minute asynchronous generation deadline while canonical playback continues. Later callbacks are terminal audit events acknowledged without media download, R2 commit, or timeline mutation.

## Intentionally not abstracted

- Durable Object constructor/migration, SQLite `transactionSync`, alarms, RPC, and WebSocket Hibernation remain native. Generic repositories must not weaken the one-writer guarantee.
- Worker `fetch` and `queue` handlers remain native so request lifetime, acknowledgement, retry, and streaming semantics are visible.
- R2 and D1 live layers use bindings, not Cloudflare REST APIs.
- Queue messages and Durable Object RPC values are encoded plain data. Effect schema classes are encoded before those structured-clone boundaries and decoded on entry.
- WebSockets carry state-control events only. Video is streamed from R2 through HTTP with immutable caching and range support.

## Session state machine

```text
idle -> planned -> generating -> ready -> idle (after rejoin position)
                  |
                  +-> failed -> planned
```

Initial planning reserves one branch without letting the Queue decide its final position. Grounding classifies the episode topic and the Durable Object atomically places the still-current planned branch between adjacent semantic anchors: Messi answers follow Messi context and rejoin at the first US Open headline; US Open answers follow that headline and rejoin at its continuation. `planned` and `generating` block a second branch. The conversational branch encodes exact grounded ingress, answer, and egress as beats in one 15-second artifact; publication stores that duration in D1 and the immutable R2 manifest, then inserts the ordered package once before the anchor. `ready` remains active until playback passes the rejoin anchor. A failed branch never changes `playlistRevision`; a committed branch changes it exactly once.

For this episode the ingress boundary is also fixed: a question asked anywhere during the Messi portion waits until the end of Messi context. The branch image-to-video request uses that validated endpoint as both its first keyframe and its required last keyframe. This gives the model the viewer's exact question plus explicit ingress, answer, and egress timing, while forcing the final head direction, eye lines, hands, framing, lighting, and expression back to the pose from which the independent US Open headline begins. The Durable Object publishes the package between those two canonical entries; fal receives only the resolved clip specification and knows nothing about timeline orchestration.

The browser advances only on the active element's identity-checked `ended` event and follows the next adjacent playlist entry; it never searches globally for a pending branch. It fully fetches the session-authorized canonical set into local object URLs before playback and keeps two layered video elements: the active element retains its last frame while the standby element loads, decodes, and begins playback beneath it. A single animation-frame layer swap performs the handoff; only afterward may the old element become the next standby. Polling can preload a newly committed branch but cannot mutate or replace the active element or move that branch ahead of its semantic boundary. If branch media cannot load, the sequencing reducer marks that clip unavailable and continues through re-entry to canonical content without replay.

## Artifact commit boundary

1. Validate the schema-authorized five-second canonical or 15-second branch contract, content type, bounded size, and MP4 signature (real provider).
2. Compute SHA-256 and derive the immutable media key.
3. Conditionally put media with checksum and immutable HTTP metadata.
4. Read the object metadata back and verify the committed byte count.
5. Conditionally put the immutable manifest.
6. Ask the session Durable Object to publish; it accepts only the current branch.

The playlist projection never references a candidate URL or provider response directly.
