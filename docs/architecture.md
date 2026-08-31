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
  -> fake or fal provider
  -> validateCommitArtifact (R2 media + immutable manifest)
  -> publishTimeline
  -> native DO compare/current-branch check + revision commit
  -> WebSocket control event / playlist polling
```

Queue delivery and provider completion may happen more than once or out of order. D1 claims external work once, while the Durable Object independently rejects any result that no longer matches its active branch. This two-boundary check prevents both avoidable duplicate provider submissions and duplicate playlist publication.

## Swappable pieces

| Contract                 | Live implementation                            | Replacement examples                             |
| ------------------------ | ---------------------------------------------- | ------------------------------------------------ |
| `GenerationProvider`     | deterministic fake or fal H3 Max queue adapter | another video model, self-hosted H3              |
| `ArtifactStore`          | R2 content-addressed commit                    | R2 + containerized normalizer/CMAF packager      |
| `AuditLedger`            | D1                                             | another cross-session analytics/ledger store     |
| clip queue projection    | JSON committed clip queue                      | dynamic HLS/CMAF manifest adapter                |
| future reasoning service | none in this slice                             | AI Gateway-backed intent/producer/director calls |
| Effect service layers    | live Cloudflare bindings                       | deterministic test layers                        |

`src/services.ts` contains contracts and tagged errors. `src/layers.ts` contains live adapter layers. `src/use-cases/` contains named orchestration. `src/domain.ts` is the single schema and branded-ID boundary. `src/index.ts` and `src/session-do.ts` are delivery adapters/public facade.

`src/fal-provider.ts` is the replaceable provider request boundary. Its schema-checked `h3-max-cost-first/1` profile compiles a deterministic generation plan into exactly five seconds, `480P`, balanced prompt expansion, `16:9`, and safety checking. Sync/base64 response modes are intentionally absent so live work stays on the asynchronous queue/webhook path. Pricing is deliberately not part of this runtime contract because fal rates are volatile and must be checked before paid tests.

`src/domain.ts` separately models fal's encoded webhook envelope and its decoded provider data. The wire codec validates the JSON string in `payload.video.url`, transforms it to an HTTPS `URL`, and preserves documented nullable fields such as `expanded_prompt`. Signature verification runs over the raw bytes before this decode. A claimed delivery moves from `PROCESSING` to `COMPLETED`; transient downstream failures mark it `RETRYABLE`, and an abandoned processing lease can be reclaimed after two minutes. Media fetches use manual redirects and reject every redirect. Late results are terminal audit events: the Session Durable Object reports whether its active branch can still accept publication, so callbacks beyond the 25-second branch deadline are acknowledged without media download, R2 commit, or timeline mutation.

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

Planning chooses the rejoin anchor before dispatch. `planned` and `generating` block a second branch. `ready` remains active until playback passes the rejoin anchor. A failed branch never changes `playlistRevision`; a committed branch changes it exactly once.

## Artifact commit boundary

1. Validate expected five-second contract, content type, bounded size, and MP4 signature (real provider).
2. Compute SHA-256 and derive the immutable media key.
3. Conditionally put media with checksum and immutable HTTP metadata.
4. Read the object metadata back and verify the committed byte count.
5. Conditionally put the immutable manifest.
6. Ask the session Durable Object to publish; it accepts only the current branch.

The playlist projection never references a candidate URL or provider response directly.
