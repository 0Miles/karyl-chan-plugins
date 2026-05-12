/**
 * Shared playback-mutation actions.
 *
 * The "skip past dead tracks" / "step back" / "stop & leave" / "pause"
 * logic was duplicated between the `/radio` slash handler and the WebUI
 * session routes; it now lives here so the now-playing message buttons
 * (and any future caller) reuse it too. No Fastify deps — callers pass a
 * `botRpc`, so this works from a command handler, an HTTP route or a
 * background interval alike.
 *
 * These functions do NOT register the guild with the auto-advance loop
 * (`seenGuilds.add`) — that's the caller's job, since not every caller
 * has (or should have) the `seenGuilds` set in scope.
 */
import {
  type LoopMode,
  type Track,
  advance,
  previous,
  requeueFront,
  reset,
  setCurrent,
} from "./queue.js";
import { playTrack } from "./resolver.js";

export type BotRpc = (path: string, body?: unknown) => Promise<unknown | null>;

const voicePlay =
  (botRpc: BotRpc, guildId: string) =>
  (url: string): Promise<unknown | null> =>
    botRpc("/api/plugin/voice.play", { guild_id: guildId, url });

/** Cycle the loop mode: off → track → queue → off. */
export function cycleLoopMode(mode: LoopMode): LoopMode {
  return mode === "off" ? "track" : mode === "track" ? "queue" : "off";
}

export type NextResult =
  /** A track is now playing. */
  | { kind: "playing"; track: Track }
  /** Queue ran dry — playback was stopped. */
  | { kind: "queue-empty" }
  /** Resolved fine but `voice.play` failed — re-queued at the front to retry. */
  | { kind: "play-failed"; track: Track }
  /** Skipped past several unplayable tracks and gave up — try again. */
  | { kind: "exhausted" };

/**
 * Advance to the next queued track, skipping past entries that can't be
 * resolved (deleted / private playlist items) — up to a few hops. Asks
 * the bot to stop playback when the queue is empty.
 */
export async function doNext(
  guildId: string,
  botRpc: BotRpc,
): Promise<NextResult> {
  const play = voicePlay(botRpc, guildId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = advance(guildId);
    if (!next) {
      await botRpc("/api/plugin/voice.stop", { guild_id: guildId }).catch(
        () => null,
      );
      return { kind: "queue-empty" };
    }
    const o = await playTrack(next, play);
    if (o.ok) {
      setCurrent(guildId, o.track);
      return { kind: "playing", track: o.track };
    }
    if (o.reason === "play-failed") {
      requeueFront(guildId, next);
      return { kind: "play-failed", track: next };
    }
    // unresolvable — advance() already dropped it; try the next.
  }
  return { kind: "exhausted" };
}

export type PrevResult =
  | { kind: "playing"; track: Track }
  /** `voice.play` failed; kept as current unless it's a lazy (re-resolvable) entry. */
  | { kind: "play-failed"; track: Track }
  | { kind: "no-history" };

/** Step back to the most recently played track. */
export async function doPrev(
  guildId: string,
  botRpc: BotRpc,
): Promise<PrevResult> {
  const prev = previous(guildId);
  if (!prev) return { kind: "no-history" };
  const o = await playTrack(prev, voicePlay(botRpc, guildId));
  if (o.ok) {
    setCurrent(guildId, o.track);
    return { kind: "playing", track: o.track };
  }
  // Keep `prev` as current on a transient failure so the history entry
  // isn't silently lost; a lazy entry that won't resolve at all is dropped
  // (showing it as "now playing" would lie).
  if (!prev.needsResolve) setCurrent(guildId, prev);
  return { kind: "play-failed", track: prev };
}

/** Stop playback, clear the queue, leave voice. */
export async function doStop(guildId: string, botRpc: BotRpc): Promise<void> {
  await Promise.all([
    botRpc("/api/plugin/voice.stop", { guild_id: guildId }),
    botRpc("/api/plugin/voice.leave", { guild_id: guildId }),
  ]);
  reset(guildId);
}

/**
 * Pause / resume the current track. `paused` undefined → toggle. Returns
 * the resulting paused state (best-effort — false if the RPC failed).
 */
export async function doPause(
  guildId: string,
  botRpc: BotRpc,
  paused?: boolean,
): Promise<{ paused: boolean }> {
  const res = (await botRpc("/api/plugin/voice.pause", {
    guild_id: guildId,
    ...(paused !== undefined ? { paused } : {}),
  })) as { paused?: boolean } | null;
  return { paused: res?.paused === true };
}
