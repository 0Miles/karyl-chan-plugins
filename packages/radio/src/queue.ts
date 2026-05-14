/**
 * Per-guild playback state — cursor-based playlist.
 *
 * A guild's session is a single ordered `tracks[]` plus a `cursor`
 * pointing at the currently-playing index. Everything else is a view
 * over those two:
 *
 *   current  = tracks[cursor]              (when cursor >= 0)
 *   upcoming = tracks.slice(cursor + 1)    (the WebUI "queue" section)
 *   played   = tracks.slice(0, cursor)     (rendered reversed = newest first)
 *
 * Loop modes:
 *   off    — peekNext returns null past the last index (then the
 *            session stops, or autoplay refills if enabled)
 *   track  — peekNext / peekPrev return the same track (cursor doesn't
 *            move; voice.play re-attacks the file)
 *   queue  — peekNext past the last wraps to 0; peekPrev before 0
 *            wraps to the last
 *
 * Loop = queue under the previous (queue / history / playLog) model
 * duplicated the just-prev'd track into the queue tail; cursor-based
 * navigation can't produce that aliasing because the same Track lives
 * at exactly one index.
 *
 * Resolution / play pattern: callers `peekNext()` to get the candidate
 * idx + track, `await playTrack(...)`, then `commitCursor(idx)` ONLY on
 * success. play-failed leaves the cursor where it was (the track is
 * still in the playlist for retry); unresolvable callers call
 * `removeTrackAt(idx)` and try again.
 *
 * State is in-memory and per-guild; a session is dropped only by
 * `reset()` (i.e. /radio stop). Played portion is capped at
 * MAX_PLAYED entries — older played tracks shift off the front and
 * the cursor decreases to compensate.
 */

export type LoopMode = "off" | "track" | "queue";

export interface Track {
  url: string;
  label: string;
  /** Stable per-enqueue id; used as a v-for key + addressable id for
   *  the WebUI's dequeue / (future) reorder / jump endpoints. */
  qid?: number;
  /** Discord user id who queued it (for "queued by" mentions in Discord). */
  queuedBy: string | null;
  /**
   * Display name of whoever queued it, captured at enqueue time — used by
   * the WebUI (which can't render a `<@id>` mention). Absent for tracks
   * queued from the WebUI itself (no per-action user) or by an older bot.
   */
  queuedByName?: string;
  /** Library track id, when this track came from the downloaded library. */
  trackId?: string;
  /** Cover image URL (library metadata), for the WebUI now-playing card. */
  coverUrl?: string;
  /** Where the entry came from — user-queued ("user", the default) or
   *  appended by the autoplay refill ("autoplay"). Used by the WebUI's
   *  "Clear ♾️ autoplay" button to wipe AI-added tracks without touching
   *  the user's own queue. Omitted on legacy tracks → treated as "user". */
  source?: "user" | "autoplay";
  /**
   * The original *page* URL this track was sourced from — a YouTube /
   * SoundCloud / Bandcamp / … page, or a library track's download URL —
   * kept even after the link has been resolved to a (signed, opaque) CDN
   * stream URL. Seeds autoplay recommendations when it's a YouTube watch
   * URL (see advance-loop.ts) and is what the WebUI links a track title
   * to. Absent for stations and direct media URLs (their `url` already
   * *is* the source).
   */
  originUrl?: string;
  /**
   * When true, `url` is a *page* URL (e.g. a YouTube watch URL queued
   * from a playlist) that must be re-resolved to a playable stream URL
   * — or to the local library file if it's since been downloaded —
   * right before playback. Resolution at play time keeps the (signed,
   * short-lived) stream URLs fresh and avoids N yt-dlp calls up front.
   */
  needsResolve?: boolean;
}

export interface GuildState {
  /** Full ordered playlist for this session — single source of truth. */
  tracks: Track[];
  /** Index of the currently-playing track; -1 = nothing playing yet. */
  cursor: number;
  loop: LoopMode;
  /**
   * When true, the moment a track becomes current AND it's the last in
   * the playlist AND loop is "off", fetch a YouTube "mix" seeded from
   * that track and append the recommendations. See advance-loop.ts.
   */
  autoplay: boolean;
  /** Last YouTube video id we generated autoplay recs from (de-bounces refills). */
  autoplaySeededFrom: string | null;
  /** How many recommendations the autoplay refill appends per fire. */
  autoplayFetchCount: number;
  /**
   * The session has been exhausted — peekNext returned null after a
   * track ended or the user clicked /next past the last track, and the
   * caller decided to stop rather than loop. Tells the advance loop the
   * session is finished (isIdle flips true → teardown), and the WebUI
   * snapshot to show "Nothing playing". Cleared by enqueue() / commitCursor()
   * — any new play intent revives the session.
   */
  done: boolean;
}

/** Default for `GuildState.autoplayFetchCount` — recs queued per refill. */
export const DEFAULT_AUTOPLAY_FETCH_COUNT = 7;
/** Hard cap for `/radio autoplay-count` (a YouTube mix realistically
 *  yields ~25–50 entries, fewer after de-duping recently played ones). */
export const MAX_AUTOPLAY_FETCH_COUNT = 25;

/** Played portion is trimmed to at most this many entries (oldest off). */
const MAX_PLAYED = 100;

const states = new Map<string, GuildState>();
let nextQid = 1;

function ensure(guildId: string): GuildState {
  let s = states.get(guildId);
  if (!s) {
    s = {
      tracks: [],
      cursor: -1,
      loop: "off",
      autoplay: false,
      autoplaySeededFrom: null,
      autoplayFetchCount: DEFAULT_AUTOPLAY_FETCH_COUNT,
      done: false,
    };
    states.set(guildId, s);
  }
  return s;
}

export function getState(guildId: string): GuildState | null {
  return states.get(guildId) ?? null;
}

// ── views ─────────────────────────────────────────────────────────────

export function getCurrent(s: GuildState): Track | null {
  if (s.done) return null;
  return s.cursor >= 0 && s.cursor < s.tracks.length ? s.tracks[s.cursor] : null;
}

export function getUpcoming(s: GuildState): Track[] {
  return s.cursor < 0 ? s.tracks.slice() : s.tracks.slice(s.cursor + 1);
}

/** Played portion in stored (oldest-first) order; callers reverse for display. */
export function getPlayed(s: GuildState): Track[] {
  return s.cursor <= 0 ? [] : s.tracks.slice(0, s.cursor);
}

// ── enqueue / mutate playlist ────────────────────────────────────────

export function enqueue(guildId: string, track: Track): number {
  const s = ensure(guildId);
  if (track.qid === undefined) track.qid = nextQid++;
  s.tracks.push(track);
  // Adding a track revives a previously-finished session — the advance
  // loop's next tick will see `done=false` + `!status.playing` + a fresh
  // peekNext candidate and start playing.
  s.done = false;
  // First enqueue while idle: leave cursor at -1; the caller's first
  // advance() will commit it to 0. Don't auto-play just by enqueueing.
  return s.tracks.length - s.cursor - 1; // upcoming count after this push
}

/**
 * Put `track` back so the *next* advance picks it up — used by the
 * advance loop when voice.play fails transiently. With the cursor model
 * the cursor never moved past it (play-failed = no commit), so we just
 * insert immediately after the cursor.
 */
export function requeueFront(guildId: string, track: Track): void {
  const s = ensure(guildId);
  if (track.qid === undefined) track.qid = nextQid++;
  s.tracks.splice(s.cursor + 1, 0, track);
}

/** Drop the upcoming portion — leaves played + current intact. */
export function clearQueue(guildId: string): void {
  const s = ensure(guildId);
  if (s.cursor < 0) {
    s.tracks.length = 0;
    return;
  }
  s.tracks.length = s.cursor + 1;
}

/**
 * Remove the upcoming entry at `index` (0 = first upcoming track).
 * Returns the removed Track or null. Indices are relative to the
 * upcoming portion only — what the WebUI sees in its queue list.
 */
export function dequeueAt(guildId: string, index: number): Track | null {
  const s = ensure(guildId);
  if (!Number.isInteger(index) || index < 0) return null;
  const absIdx = s.cursor + 1 + index;
  if (absIdx >= s.tracks.length) return null;
  return s.tracks.splice(absIdx, 1)[0] ?? null;
}

/**
 * Remove every track whose `qid` is in `qids` regardless of which side
 * of the cursor it's on. Returns count actually removed. Adjusts the
 * cursor so it still points at the same Track (or to the next item, if
 * the cursor track itself was one of the removed qids).
 */
export function dequeueByQids(guildId: string, qids: number[]): number {
  const s = ensure(guildId);
  if (qids.length === 0 || s.tracks.length === 0) return 0;
  const want = new Set(qids);
  const before = s.tracks.length;
  const next: Track[] = [];
  let removedBeforeCursor = 0;
  let cursorRemoved = false;
  for (let i = 0; i < s.tracks.length; i++) {
    const t = s.tracks[i];
    if (t.qid !== undefined && want.has(t.qid)) {
      if (i < s.cursor) removedBeforeCursor++;
      else if (i === s.cursor) cursorRemoved = true;
      continue;
    }
    next.push(t);
  }
  s.tracks = next;
  s.cursor -= removedBeforeCursor;
  // If the cursor track was removed, leave cursor pointing at what's
  // now at that index (effectively the formerly-next track). If the
  // tail was also removed, clamp to -1.
  if (cursorRemoved) {
    if (s.cursor >= s.tracks.length) s.cursor = s.tracks.length - 1;
    if (s.cursor < 0) s.cursor = -1;
  }
  return before - s.tracks.length;
}

/** Remove the track at absolute index `idx`. Cursor follows the same
 *  adjustment rule as dequeueByQids. */
export function removeTrackAt(guildId: string, idx: number): Track | null {
  const s = ensure(guildId);
  if (!Number.isInteger(idx) || idx < 0 || idx >= s.tracks.length) return null;
  const [removed] = s.tracks.splice(idx, 1);
  if (idx < s.cursor) s.cursor--;
  else if (idx === s.cursor) {
    if (s.cursor >= s.tracks.length) s.cursor = s.tracks.length - 1;
  }
  return removed ?? null;
}

export function setLoop(guildId: string, mode: LoopMode): void {
  ensure(guildId).loop = mode;
}

export function setAutoplay(guildId: string, on: boolean): void {
  const s = ensure(guildId);
  s.autoplay = on;
  if (!on) s.autoplaySeededFrom = null;
}

export function setAutoplayFetchCount(guildId: string, n: number): number {
  const clamped = Math.max(
    1,
    Math.min(MAX_AUTOPLAY_FETCH_COUNT, Math.floor(n)),
  );
  ensure(guildId).autoplayFetchCount = clamped;
  return clamped;
}

/** True iff peekPrev would return a track (i.e. ⏮ button enabled). */
export function hasPrevious(guildId: string): boolean {
  const s = states.get(guildId);
  if (!s || s.done || s.tracks.length === 0) return false;
  if (s.loop === "track") return false;
  if (s.loop === "queue") return s.tracks.length > 1;
  return s.cursor > 0;
}

// ── cursor navigation ────────────────────────────────────────────────

/**
 * Compute the candidate "next" track without moving the cursor.
 * Caller must `commitCursor(idx)` after a successful play; on failure
 * the cursor stays where it is (so a play-failed track remains in the
 * playlist for retry).
 */
export function peekNext(
  guildId: string,
): { idx: number; track: Track } | null {
  const s = ensure(guildId);
  if (s.done || s.tracks.length === 0) return null;
  if (s.cursor < 0) return { idx: 0, track: s.tracks[0] };
  if (s.loop === "track") {
    return { idx: s.cursor, track: s.tracks[s.cursor] };
  }
  const next = s.cursor + 1;
  if (next < s.tracks.length) return { idx: next, track: s.tracks[next] };
  // Past the end.
  if (s.loop === "queue") return { idx: 0, track: s.tracks[0] };
  return null;
}

/** Locate a track by `qid`; returns idx + track or null. The "candidate"
 *  shape matches peekNext / peekPrev so callers can plug it into the
 *  same playTrack → commitCursor pattern. */
export function peekQid(
  guildId: string,
  qid: number,
): { idx: number; track: Track } | null {
  const s = ensure(guildId);
  const idx = s.tracks.findIndex((t) => t.qid === qid);
  return idx === -1 ? null : { idx, track: s.tracks[idx] };
}

/**
 * Move the track with `qid` so it sits immediately before the track
 * with `beforeQid`. `beforeQid === null` moves it to the very end.
 * Returns true on success, false if `qid` (or `beforeQid` when given)
 * couldn't be found. The cursor stays anchored to whichever Track was
 * currently playing (the cursor's qid).
 */
export function reorderByQid(
  guildId: string,
  qid: number,
  beforeQid: number | null,
): boolean {
  const s = ensure(guildId);
  const from = s.tracks.findIndex((t) => t.qid === qid);
  if (from === -1) return false;
  // No-op move onto itself.
  if (beforeQid === qid) return true;
  // Remember the currently-playing track's qid so we can re-find the
  // cursor after the splice (its index will have shifted).
  const cursorQid = s.cursor >= 0 ? s.tracks[s.cursor].qid : null;
  let to: number;
  if (beforeQid === null) {
    to = s.tracks.length; // splice-target index when appending
  } else {
    to = s.tracks.findIndex((t) => t.qid === beforeQid);
    if (to === -1) return false;
  }
  const [moved] = s.tracks.splice(from, 1);
  // Splicing OUT shifts the target index left by one if it was after.
  if (to > from) to--;
  s.tracks.splice(to, 0, moved);
  // Restore the cursor onto the track that was current before the move.
  if (cursorQid !== null) {
    const newCursor = s.tracks.findIndex((t) => t.qid === cursorQid);
    if (newCursor !== -1) s.cursor = newCursor;
  }
  return true;
}

/** Same shape as peekNext, but going backwards. */
export function peekPrev(
  guildId: string,
): { idx: number; track: Track } | null {
  const s = ensure(guildId);
  if (s.done || s.tracks.length === 0) return null;
  if (s.loop === "track" && s.cursor >= 0) {
    return { idx: s.cursor, track: s.tracks[s.cursor] };
  }
  const prev = s.cursor - 1;
  if (prev >= 0) return { idx: prev, track: s.tracks[prev] };
  if (s.loop === "queue") {
    const last = s.tracks.length - 1;
    return { idx: last, track: s.tracks[last] };
  }
  return null;
}

/**
 * Commit a peeked navigation: cursor → idx. Should ONLY be called once
 * voice.play has succeeded for tracks[idx]. Trims the played portion
 * if it exceeds MAX_PLAYED.
 */
export function commitCursor(guildId: string, idx: number): void {
  const s = ensure(guildId);
  if (idx < 0 || idx >= s.tracks.length) return;
  s.cursor = idx;
  // Any successful play exits the done state — even a jump back into a
  // previously-played track counts as "playing again".
  s.done = false;
  if (s.cursor > MAX_PLAYED) {
    const drop = s.cursor - MAX_PLAYED;
    s.tracks.splice(0, drop);
    s.cursor -= drop;
  }
}

/**
 * Mark the session as exhausted — peekNext / peekPrev / getCurrent will
 * report nothing, isIdle flips true, and the advance loop's next tick
 * tears down. Called by doNext when peekNext returns null and by the
 * advance loop when a track ended with no autoplay refill possible.
 * Cleared automatically by enqueue() or commitCursor().
 */
export function endSession(guildId: string): void {
  const s = ensure(guildId);
  s.done = true;
}

/**
 * Remove every track whose `source === "autoplay"`, except the cursor's
 * own track (yanking the playing entry mid-play would leave the audio
 * file streaming with no entry to render). Returns the number removed.
 * Adjusts the cursor exactly like dequeueByQids.
 */
export function clearAutoplay(guildId: string): number {
  const s = ensure(guildId);
  if (s.tracks.length === 0) return 0;
  const before = s.tracks.length;
  const next: Track[] = [];
  let removedBeforeCursor = 0;
  for (let i = 0; i < s.tracks.length; i++) {
    const t = s.tracks[i];
    if (t.source === "autoplay" && i !== s.cursor) {
      if (i < s.cursor) removedBeforeCursor++;
      continue;
    }
    next.push(t);
  }
  s.tracks = next;
  s.cursor -= removedBeforeCursor;
  // Resets the autoplay seed: the user explicitly threw out the last
  // batch, so the next "track ended on last entry" should be allowed
  // to fetch a fresh round from the same seed.
  s.autoplaySeededFrom = null;
  return before - s.tracks.length;
}

// ── legacy adapters ──────────────────────────────────────────────────
// Kept for now-playing.ts / format.ts / playback-actions.ts / web-routes
// callers that haven't migrated to peek/commit. Each "commits on call"
// (in contrast to the new peek/commit pattern) so it can't represent a
// play-failed track without further changes — those callers also use
// requeueFront() to keep the entry around.

/** Legacy: advance cursor + return new current. Use peekNext/commitCursor
 *  for the try/play/commit pattern instead. */
export function advance(guildId: string): Track | null {
  const peek = peekNext(guildId);
  if (!peek) return null;
  commitCursor(guildId, peek.idx);
  return peek.track;
}

/** Legacy: step the cursor backwards + return new current. */
export function previous(guildId: string): Track | null {
  const peek = peekPrev(guildId);
  if (!peek) return null;
  commitCursor(guildId, peek.idx);
  return peek.track;
}

/** Legacy no-op: with the cursor model, "current" is derived. Kept as a
 *  named export so call sites compile until they're migrated; calling it
 *  does nothing because the cursor was already moved by advance/peek+commit. */
export function setCurrent(_guildId: string, _track: Track | null): void {
  // Intentional no-op.
}

export function reset(guildId: string): void {
  states.delete(guildId);
}

/**
 * Drop every reference to a library track (by `trackId`) from all
 * guilds. Adjusts each guild's cursor so it keeps pointing at the same
 * Track (or to the next remaining item if the cursor's own track was
 * removed). If purging leaves the session empty, the cursor is reset
 * and loop falls back to "off" so the advance loop can stop ticking.
 */
export function purgeTrackId(trackId: string): number {
  let removed = 0;
  for (const s of states.values()) {
    if (s.tracks.length === 0) continue;
    const before = s.tracks.length;
    const next: Track[] = [];
    let removedBeforeCursor = 0;
    let cursorRemoved = false;
    for (let i = 0; i < s.tracks.length; i++) {
      const t = s.tracks[i];
      if (t.trackId === trackId) {
        if (i < s.cursor) removedBeforeCursor++;
        else if (i === s.cursor) cursorRemoved = true;
        continue;
      }
      next.push(t);
    }
    s.tracks = next;
    s.cursor -= removedBeforeCursor;
    if (cursorRemoved && s.cursor >= s.tracks.length) {
      s.cursor = s.tracks.length - 1;
    }
    if (s.tracks.length === 0) {
      s.cursor = -1;
      s.loop = "off";
    }
    removed += before - s.tracks.length;
  }
  return removed;
}
