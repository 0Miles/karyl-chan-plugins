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

import { getEndedGame, getGame } from "../game/store.js";
import { buildSnapshot } from "../game/snapshot.js";

export interface SseSubscriber {
  /** Discord user id — the snapshot is computed for this viewer. */
  userId: string;
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
 * channel. A no-op when nobody is watching. When the game is gone
 * (force-stopped, or retention expired) subscribers get `{ gone:
 * true }` so the board can show a terminal state.
 */
export function notifyGameChanged(channelId: string): void {
  const set = channels.get(channelId);
  if (!set || set.size === 0) return;
  const state = getGame(channelId) ?? getEndedGame(channelId);
  for (const sub of set) {
    try {
      sub.send(state ? buildSnapshot(state, sub.userId) : { gone: true });
    } catch {
      // Broken pipe — the route's close handler unsubscribes it.
    }
  }
}
