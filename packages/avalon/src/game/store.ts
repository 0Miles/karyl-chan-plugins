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
