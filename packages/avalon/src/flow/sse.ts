/**
 * Server-sent-events fan-out for the WebUI game board.
 *
 * Every gameplay mutation calls `notifyGameChanged(channelId)`; this
 * module rebuilds the snapshot once PER SUBSCRIBER (keyed by their
 * Discord user id) and writes it to their stream. Vision filtering
 * therefore happens per viewer — a single broadcast never carries
 * one player's role knowledge to another's connection.
 *
 * Subscribers are added by the `GET /api/game/events` route and
 * removed when that request closes.
 */

import { getGameBySession } from "../game/store.js";
import { buildSnapshot } from "../game/snapshot.js";

export interface SseSubscriber {
  /** Discord user id — the snapshot is computed for this viewer. */
  userId: string;
  /** Game instance this stream is pinned to (survives a new game). */
  sessionId: string;
  /** Write one already-encoded payload as an SSE `data:` frame. */
  send: (payload: unknown) => void;
}

const channels = new Map<string, Set<SseSubscriber>>();

/** Register a subscriber for a channel; returns an unsubscribe fn. */
export function subscribe(
  channelId: string,
  sub: SseSubscriber,
): () => void {
  let set = channels.get(channelId);
  if (!set) {
    set = new Set();
    channels.set(channelId, set);
  }
  set.add(sub);
  return () => {
    const current = channels.get(channelId);
    if (!current) return;
    current.delete(sub);
    if (current.size === 0) channels.delete(channelId);
  };
}

/**
 * Push the current per-viewer snapshot to every subscriber on this
 * channel. A no-op when nobody is watching. Each subscriber resolves
 * to its OWN pinned session — so a stream watching a finished game
 * keeps showing that game (and gets `{ gone: true }` once it ends or
 * its retention expires) rather than jumping to a new game that
 * started in the same channel.
 */
export function notifyGameChanged(channelId: string): void {
  const set = channels.get(channelId);
  if (!set || set.size === 0) return;
  for (const sub of set) {
    const game = getGameBySession(channelId, sub.sessionId);
    try {
      sub.send(game ? buildSnapshot(game, sub.userId) : { gone: true });
    } catch {
      // Broken pipe — the route's close handler unsubscribes it.
    }
  }
}
