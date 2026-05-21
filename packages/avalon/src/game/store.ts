import type { GameState } from "./state.js";

/**
 * Per-channel game store. One channel can host at most one in-flight
 * game; a fresh `/avalon start` while a game is running rejects with
 * "alreadyRunning".
 *
 * In-memory only by design (process restart wipes — same as the
 * original Python bot). The pluginInstance map is the single source
 * of truth; WebUI snapshot routes read from here.
 */

const games = new Map<string, GameState>();

export function getGame(channelId: string): GameState | null {
  return games.get(channelId) ?? null;
}

export function setGame(channelId: string, state: GameState): void {
  games.set(channelId, state);
}

export function removeGame(channelId: string): void {
  games.delete(channelId);
}

export function listGames(): GameState[] {
  return [...games.values()];
}

/**
 * Ended-game retention. `endGame` moves a finished GameState here
 * (out of the active `games` map, so a fresh `/avalon start` in the
 * same channel is unblocked) and keeps it readable for a short
 * window — long enough for players to open `/avalon webui` after the
 * game ends and review the full role reveal + verdict.
 *
 * Force-stops (`/avalon stop`, the admin force-stop route) use
 * `removeGame` and intentionally do NOT retain — a stopped game has
 * no result worth keeping.
 */
const ENDED_GAME_TTL_MS = 10 * 60_000;
const endedGames = new Map<
  string,
  { state: GameState; expiresAt: number }
>();

/** Move a finished game out of the active map into timed retention. */
export function retainEndedGame(state: GameState): void {
  const channelId = state.channelId;
  games.delete(channelId);
  endedGames.set(channelId, {
    state,
    expiresAt: Date.now() + ENDED_GAME_TTL_MS,
  });
  const handle = setTimeout(() => {
    const entry = endedGames.get(channelId);
    // Guard against evicting a *newer* ended game that replaced this
    // one in the same channel within the TTL window.
    if (entry && entry.state.sessionId === state.sessionId) {
      endedGames.delete(channelId);
    }
  }, ENDED_GAME_TTL_MS);
  if (typeof handle.unref === "function") handle.unref();
}

/** Read a retained ended game, or null once it has expired. */
export function getEndedGame(channelId: string): GameState | null {
  const entry = endedGames.get(channelId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    endedGames.delete(channelId);
    return null;
  }
  return entry.state;
}

/**
 * Resolve the game in `channelId` whose `sessionId` matches — the
 * active game, or a still-retained ended one. Returns null when that
 * specific session is gone (e.g. a fresh `/avalon start` now occupies
 * the channel with a different session).
 *
 * The WebUI passes the sessionId from its link so a board stays
 * pinned to the exact game instance it was issued for, instead of
 * silently following whatever game currently holds the channel.
 * `sessionId` is also the stable key a future record-persistence /
 * spectator feature would index games by.
 */
export function getGameBySession(
  channelId: string,
  sessionId: string,
): GameState | null {
  const active = games.get(channelId);
  if (active && active.sessionId === sessionId) return active;
  const ended = endedGames.get(channelId);
  if (
    ended &&
    ended.expiresAt > Date.now() &&
    ended.state.sessionId === sessionId
  ) {
    return ended.state;
  }
  return null;
}

/**
 * Per-channel promise-chain lock. Slash commands, button handlers, and
 * the WebUI all mutate the same `GameState`; mutations must serialise
 * per channel so e.g. two players clicking "join" in the same
 * millisecond don't race to overwrite the roster array. Same shape as
 * `withGuildLock` in the radio plugin.
 *
 * Different channels run in parallel — locking is per-channel, not
 * global.
 */
const chains = new Map<string, Promise<unknown>>();

export function withChannelLock<T>(
  channelId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(channelId) ?? Promise.resolve();
  const result = prev.then(fn, fn);
  const link: Promise<unknown> = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(channelId, link);
  void link.then(() => {
    if (chains.get(channelId) === link) chains.delete(channelId);
  });
  return result;
}
