# H3 Conversational Video — working vertical slice

Live prototype: [h3-conversational-video-prototype.yo-617.workers.dev](https://h3-conversational-video-prototype.yo-617.workers.dev)

This repository is a deployable Cloudflare prototype of the first interactive “Signal Room” show. Its target shared episode is a four-clip sports-news program: two Messi clips, then two US Open clips. During the Messi segment a viewer may create one private response package; that package owns its natural ingress, answer, and egress, then resumes exactly once at the first US Open clip. Only validated, committed media may enter the playlist, and failure falls back to uninterrupted canonical playback.

The sports episode is published atomically only after all four canonical artifacts pass continuity review. Until then, new sessions retain the legacy fixture timeline; partial or rejected builds are never exposed as the shared program.

The deployed prototype uses the real fal.ai H3 Max adapter. Automated tests and `wrangler.test.jsonc` remain cost-free through the deterministic fake provider. A live typed branch can incur fal.ai usage only after the account has credits; provider rejection falls back to canonical playback.

## Fastest demo path

Requirements: Node.js 24+ and npm.

```bash
npm install
npm run types
npm run db:local
npm run dev
```

Open [http://localhost:8787](http://localhost:8787), let the canonical program advance, and ask a typed question. The UI shows the branch state, inserts the generated response when committed, and automatically rejoins the shared show. Local state is stored under `.wrangler/`.

Run the complete verification suite with:

```bash
npm run check
```

## API

```bash
# Create a session
curl -sS http://localhost:8787/v1/sessions \
  -H 'content-type: application/json' \
  -d '{}'

# Submit a typed viewer event (replace SESSION_ID)
curl -sS http://localhost:8787/v1/sessions/SESSION_ID/events \
  -H 'content-type: application/json' \
  -d '{"eventId":"event-demo-0001","text":"Why does the buffer matter?","playbackPositionMs":10000,"playlistRevision":1}'

curl -sS http://localhost:8787/v1/sessions/SESSION_ID/state
curl -sS http://localhost:8787/v1/sessions/SESSION_ID/playlist
```

`GET /v1/sessions/:id/ws` upgrades to a WebSocket for control events (`branch.status`, `playlist.revised`); media bytes never traverse the socket.

## Architecture

- One SQLite-backed `SessionDurableObject` per session is the serialized authority for state version, canonical playhead anchor, 20-second buffer target, branch lifecycle, rejoin anchor, idempotency keys, and playlist revision.
- Cloudflare Queues perform asynchronous generation but carry the desired ordinal and state version; they never decide publication order.
- R2 keys are content addressed: `artifacts/sha256/<digest>/clip.<ext>` and `artifacts/sha256/<digest>/manifest.v1.json`. A playlist can reference only the artifact after checksum, type, size, read-after-write, and manifest commit checks pass.
- D1 records sessions, viewer events, provider attempts, webhook claims, generation state, and the cost-ledger boundary. It does not own session ordering.
- The player consumes a replaceable committed clip queue. Dynamic HLS/CMAF is the target adapter after codec/timestamp continuity is proven.
- The prompt compiler is pure and deterministic. Character, world, session, and shot contexts are explicit; fal.ai receives one resolved specification and has no tools or orchestration authority. Canonical media is stored once in R2 and cataloged in D1, then projected into each session with session-bound media URLs.
- The current slice does not make an LLM call, so AI Gateway is not invoked. A future planning/intent layer belongs behind an Effect service and should use AI Gateway without changing the provider or session-ordering contracts.

See [docs/architecture.md](docs/architecture.md) for module boundaries, swappable components, and intentionally native Cloudflare invariants.

## Effect architecture

Effect owns schema-derived domain contracts, branded identifiers, tagged errors, service contracts, layers, configuration, and named use cases. `src/index.ts` and `src/session-do.ts` remain thin native delivery adapters. They decode encoded payloads at the application boundary, run an Effect program, and encode results before crossing Worker/Queue/Durable Object RPC boundaries.

The repository follows the installed upstream Effect skill and `node_modules/effect/AGENTS.md`. That official skill explicitly prescribes the `effect@rc` channel. On 2026-08-31 npm reported `effect@latest` as `3.22.1` and `effect@rc` as `4.0.0-rc.112`; this project pins `4.0.0-rc.112` exactly because the user required faithful use of that official skill. This is the only intentional non-stable-channel dependency.

All direct packages were checked against current npm metadata and are pinned exactly in `package-lock.json`. TypeScript `6.0.3` is the newest stable release compatible with the latest `typescript-eslint@8.69.0`, whose peer range is `<6.1.0`; TypeScript `7.0.2` is therefore intentionally not used until that current lint toolchain declares compatibility.

## fal.ai mode

Personalized branches use `minimax/h3-max/text-to-video`. Continuity-sensitive canonical builds use the official `minimax/h3-max/image-to-video` endpoint and an explicit first-frame `image_url`; on this endpoint the input image determines aspect ratio. Both paths use the versioned `h3-max-cost-first/1` policy: five-second duration, `480P` resolution, `balanced` prompt expansion, safety enabled, deterministic seeds, and asynchronous queue mode. The adapter omits sync/base64 response fields. `src/fal-provider.ts` owns these typed contracts so fal defaults cannot silently move the prototype back to `768P`.

The versioned continuity contract `sports-news-continuity/1` fixes the fictional anchors, faces, wardrobe, studio, lighting, camera/lens/framing, voice identities, cadence, ambient audio, color grade, and chronological blocking. The first clip starts from [`assets/sports-news-visual-bible-v1.png`](assets/sports-news-visual-bible-v1.png); each later clip starts from the validated endpoint frame of its predecessor. D1 stores continuity and validation evidence and R2 holds the immutable source/endpoint images and MP4 manifests. The image-to-video route must serve both `HEAD` and `GET`, because fal probes the continuity asset before downloading it.

The visual bible was generated with the built-in Codex image-generation tool from the approved fictional-anchor newsroom brief, then visually inspected before upload. It contains no celebrity likeness or sports footage.

Pricing is checked at request time rather than encoded in runtime policy. As a time-sensitive snapshot only, the official model page on 2026-08-31 listed promotional rates of $0.025 per output second at `480P` and $0.04 per output second at `768P`, stated that the promotion ended September 1, and stated that those rates would then double. Verify the current official model page immediately before adding credits or running a paid test.

The deployed configuration already has `PROVIDER_MODE: "fal"`, the production Worker URL, and `FAL_KEY` declared as a required secret. For a new Worker/account:

1. Set `PUBLIC_BASE_URL` to its final HTTPS Worker URL and keep `PROVIDER_MODE` as `fal`.
2. Add the secret interactively (never place its value in source or config):

```bash
npx wrangler secret put FAL_KEY
```

3. Run `npm run types`, `npm run check`, and `npx wrangler deploy`.

On 2026-08-31, one controlled live request against the zero-credit account was rejected before fal issued a provider request ID. D1 recorded `FAL_ACCOUNT_REJECTED`, no cost entry was created, the private branch became `failed`, and the revision-1 canonical playlist continued unchanged. Terminal 4xx account/payment/input rejections are acknowledged without provider resubmission; only transient 408/425/429/5xx submission failures are eligible for Queue retry.

fal webhooks are verified before JSON parsing using the four official signature headers, a five-minute timestamp window, raw-body SHA-256, and Ed25519 public keys from fal’s JWKS. The signed request ID must match an expected D1 generation record. The explicit wire schema accepts fal’s JSON URL string and decodes it to an HTTPS `URL` on fal’s documented CDN only at the provider boundary; malformed or unsafe URL values receive a typed `422` response without logging the signed body or media URL. Webhook claims use `PROCESSING`, `RETRYABLE`, and `COMPLETED` states so transient ingestion failures can be redelivered without republishing completed work. fal media downloads use Workers' supported manual redirect mode and reject redirects before reading bytes. A result that arrives after the 25-second private-branch deadline is acknowledged and recorded as `FAL_RESULT_AFTER_DEADLINE`, but is not downloaded, committed to R2, or inserted into the timeline.

Current primary references:

- [fal H3 Max text-to-video API](https://fal.ai/models/minimax/h3-max/text-to-video/api)
- [fal H3 Max image-to-video API](https://fal.ai/models/minimax/h3-max/image-to-video/api)
- [fal asynchronous inference](https://fal.ai/docs/documentation/model-apis/inference/queue)
- [fal webhook verification](https://fal.ai/docs/documentation/model-apis/inference/webhooks)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/get-started/)
- [Cloudflare Queue JavaScript API](https://developers.cloudflare.com/queues/configuration/javascript-apis/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)

## Cloudflare deployment

The Worker is deliberately named `h3-conversational-video-prototype`; it will not target an unrelated service. Check authentication first:

```bash
npx wrangler whoami
```

The prototype account already has the following minimum resources. For a fresh account, create them only after confirming the names are unused:

```bash
npx wrangler d1 create h3-conversational-video
npx wrangler r2 bucket create h3-media-prototype
npx wrangler queues create h3-branch-generation-prototype
npx wrangler queues create h3-branch-generation-dlq-prototype
```

`wrangler.jsonc` contains the deployed D1 ID. For a fresh account, replace that ID with the value returned by `d1 create`, set `PUBLIC_BASE_URL` to the new Worker origin, then:

```bash
npx wrangler d1 migrations apply h3-conversational-video --remote
npm run types
npm run check
npx wrangler deploy
```

For a cost-free deployment, explicitly set `PROVIDER_MODE` back to `fake`, remove the `secrets.required` declaration if the Worker should no longer require fal credentials, regenerate types, validate, and deploy. Live fal mode can create paid generation usage once the account has credits.

The current prototype deployment was validated on 2026-08-31 with remote session creation, Queue delivery, Durable Object publication, R2 artifact commit, revision-2 playlist projection, full and byte-range media reads, and cross-session media denial. The sports canonical builder additionally requires a `CANONICAL_ADMIN_TOKEN` Worker secret; it is never placed in source or configuration.

## Correctness and degradation

Tests cover deterministic canonical planning, the exact 480P image-to-video request, continuity-asset `HEAD`/`GET`, canonical reuse, atomic branch-package ordering, single-branch enforcement, duplicate viewer event/queue/webhook handling, failure fallback, Durable Object eviction/recovery, committed-only playlist projection, semantic re-entry ordering, player identity stability across polling, and playlist revision changes. Provider failure or deadline expiry marks the branch failed without changing playlist revision, so canonical playback continues.

The simulator uses SVG visual fixtures, not production video. Before replacing it with HLS, run the media proof described in the product document: consecutive MP4 codec/profile/timestamp inspection, first/last-frame continuity, audio normalization, and Safari/iOS plus Chrome/Android playback validation.

## Secrets and generated files

- `.dev.vars`, `.env`, generated Wrangler state, logs, and startup profiles are ignored.
- `worker-configuration.d.ts` is generated with `wrangler types` and intentionally not hand-edited.
- `FAL_KEY` is read only from the runtime secret binding and never logged.
- Personalized media is served only through the Worker’s committed manifest path. Authentication is the next production-hardening step; this labeled prototype does not yet implement user identity.
