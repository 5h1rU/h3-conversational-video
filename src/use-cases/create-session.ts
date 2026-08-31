import { Clock, Effect, Schema } from "effect";
import {
  EpisodeId,
  SessionId,
  ShowId,
  type CreateSessionPayload,
} from "../domain";
import {
  SPORTS_EPISODE_ID,
  SPORTS_SHOW_ID,
  SPORTS_SHOW_VERSION,
} from "../canonical-sports";
import { IdGenerator, InputError, SessionRepository } from "../services";

const decodeSessionId = Schema.decodeUnknownEffect(SessionId);
const decodeShowId = Schema.decodeUnknownEffect(ShowId);
const decodeEpisodeId = Schema.decodeUnknownEffect(EpisodeId);
const invalid = (message: string) => new InputError({ message });

export const createSession = Effect.fn("createSession")(function* (
  payload: CreateSessionPayload,
) {
  const ids = yield* IdGenerator;
  const repository = yield* SessionRepository;
  const generated = payload.sessionId ?? (yield* ids.next);
  const sessionId = yield* decodeSessionId(generated).pipe(
    Effect.mapError(() => invalid("Invalid session id")),
  );
  const showId = yield* decodeShowId(payload.showId ?? SPORTS_SHOW_ID).pipe(
    Effect.mapError(() => invalid("Invalid show id")),
  );
  const episodeId = yield* decodeEpisodeId(
    payload.episodeId ?? SPORTS_EPISODE_ID,
  ).pipe(Effect.mapError(() => invalid("Invalid episode id")));
  const now = yield* Clock.currentTimeMillis;
  return yield* repository.initialize({
    sessionId,
    showId,
    episodeId,
    showVersion: payload.showVersion ?? SPORTS_SHOW_VERSION,
    now,
    canonicalEntries: payload.canonicalEntries ?? [],
  });
});
