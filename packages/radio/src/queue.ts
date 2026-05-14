/**
 * Per-guild playback queue + loop state.
 *
 * Tracks which URL is "now playing" in each guild, what's lined up
 * after it, and what was played before it (for "previous"). Supports
 * three loop modes:
 *
 *   off    — when a track ends, advance to the next item (or stop if
 *            the queue is empty)
 *   track  — replay the current track until cleared
 *   queue  — like off, but a finished track is appended back to the
 *            tail of the queue, so the cycle repeats
 *
 * Stations and arbitrary URLs are both stored as `Track` entries with
 * a label (so the UI can say "Now playing: SomaFM Groove Salad" vs.
 * just dumping the URL). Library-sourced tracks also carry `trackId`
 * and `coverUrl` so the WebUI can render the album art and link back.
 *
 * State is in-memory and resets on plugin restart; for a stopgap
 * persistence story future versions could call the bot's plugin KV
 * RPC, but a music queue is naturally session-scoped so most users
 * won't notice the gap. A guild's state is dropped only by `/radio
 * stop` (`reset()`) or a plugin restart — the advance loop merely
 * stops *ticking* an idle guild (so the play log survives a queue that
 * ran dry); a bot in many guilds therefore holds one small bounded
 * `GuildState` per guild that ever started radio. Acceptable for this
 * scale; revisit (idle-TTL sweep) if it ever isn't.
 */

export type LoopMode = "off" | "track" | "queue";

export interface Track {
  url: string;
  label: string;
  /**
   * Stable queue-entry id assigned by enqueue(). The WebUI uses this as
   * a v-for key and as the identifier in POST /api/session/<g>/dequeue
   * so per-item removals don't depend on volatile array indices (which
   * shift under concurrent dequeues / auto-advance). Set on every queue
   * push; persists onto current / history / playLog when the track
   * leaves the queue but is meaningful only while it's still in queue.
   */
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

/**
 * One entry in a guild's session play log. `seq` is a stable, monotonic
 * id (process-global) used by the WebUI's re-queue buttons so a click
 * targets the right entry even if the log shifts (cap eviction, a
 * re-played track moving to the tail) between the snapshot poll and the
 * click — the route looks it up by `seq`, not by array index.
 */
export interface PlayLogEntry {
  seq: number;
  track: Track;
}

export interface GuildState {
  current: Track | null;
  queue: Track[];
  /** Back-stack for the "previous" button — newest last, popped on `previous()`. Capped. */
  history: Track[];
  /**
   * Distinct, recency-ordered log of the tracks played this session
   * (oldest first, newest last; re-playing a track moves it to the
   * tail rather than duplicating it), capped at PLAY_LOG_MAX. Unlike
   * `history` it's never popped — it survives skipping forward and
   * stepping back, so the WebUI "played this session" list / re-queue
   * buttons see the full set. Reset by `/radio stop` (`reset()`) or a
   * plugin restart; NOT cleared just because the queue ran dry.
   */
  playLog: PlayLogEntry[];
  loop: LoopMode;
  /**
   * When true, the auto-advance loop keeps the queue topped up with
   * YouTube "mix" recommendations seeded from the most recent YouTube
   * track this session (see advance-loop.ts) — so playback continues
   * past the end of the queue. Off by default; only acts while
   * `loop === "off"`. Set via `/radio autoplay`, the WebUI toggle, or
   * automatically when a `/radio play` source is a YouTube URL carrying
   * a `list=` param. Survives a dry queue; reset by `/radio stop`.
   */
  autoplay: boolean;
  /**
   * The YouTube video id we last generated autoplay recommendations
   * from. Set before the (slow) yt-dlp fetch so a still-running or
   * fruitless fetch doesn't re-trigger every tick; cleared when
   * autoplay is turned off.
   */
  autoplaySeededFrom: string | null;
  /**
   * How many recommendations the autoplay refill enqueues at once when
   * the queue runs dry. Higher = fewer (rarer) yt-dlp "mix" fetches and
   * a longer look-ahead; lower = recommendations track the current song
   * more closely. Live-tunable per session via `/radio autoplay-count`.
   */
  autoplayFetchCount: number;
}

/** Default for `GuildState.autoplayFetchCount` — recs queued per refill. */
export const DEFAULT_AUTOPLAY_FETCH_COUNT = 7;
/** Hard cap for `/radio autoplay-count` (a YouTube mix realistically
 *  yields ~25–50 entries, fewer after de-duping recently played ones). */
export const MAX_AUTOPLAY_FETCH_COUNT = 25;

/** How many played tracks to remember for the "previous" button. */
const HISTORY_MAX = 50;
/** How many distinct tracks to keep in the per-session play log. */
const PLAY_LOG_MAX = 50;

let nextPlayLogSeq = 1;

const states = new Map<string, GuildState>();

function ensure(guildId: string): GuildState {
  let s = states.get(guildId);
  if (!s) {
    s = {
      current: null,
      queue: [],
      history: [],
      playLog: [],
      loop: "off",
      autoplay: false,
      autoplaySeededFrom: null,
      autoplayFetchCount: DEFAULT_AUTOPLAY_FETCH_COUNT,
    };
    states.set(guildId, s);
  }
  return s;
}

export function getState(guildId: string): GuildState | null {
  return states.get(guildId) ?? null;
}

/**
 * Replace the current track and start "playing" it (caller drives
 * playback). When `track` is non-null it's recorded in the session play
 * log: any existing entry for the same `url` is dropped, then a fresh
 * entry is appended at the tail (so the log stays distinct and
 * recency-ordered), evicting the oldest if over PLAY_LOG_MAX.
 */
export function setCurrent(guildId: string, track: Track | null): void {
  const s = ensure(guildId);
  s.current = track;
  if (track) {
    const existingIdx = s.playLog.findIndex((e) => e.track.url === track.url);
    if (existingIdx !== -1) s.playLog.splice(existingIdx, 1);
    s.playLog.push({ seq: nextPlayLogSeq++, track });
    if (s.playLog.length > PLAY_LOG_MAX) {
      s.playLog.splice(0, s.playLog.length - PLAY_LOG_MAX);
    }
  }
}

let nextQid = 1;

export function enqueue(guildId: string, track: Track): number {
  const s = ensure(guildId);
  if (track.qid === undefined) track.qid = nextQid++;
  s.queue.push(track);
  return s.queue.length;
}

export function requeueFront(guildId: string, track: Track): void {
  // Retain the existing qid when a play-failed track is pushed back —
  // the WebUI is still showing it under that key.
  ensure(guildId).queue.unshift(track);
}

export function clearQueue(guildId: string): void {
  ensure(guildId).queue.length = 0;
}

/** Remove the queue entry at `index` (0-based). Returns the removed track or null. */
export function dequeueAt(guildId: string, index: number): Track | null {
  const s = ensure(guildId);
  if (!Number.isInteger(index) || index < 0 || index >= s.queue.length) {
    return null;
  }
  return s.queue.splice(index, 1)[0] ?? null;
}

/**
 * Remove every queue entry whose `qid` is in `qids`. Returns the count
 * of entries actually removed (entries already gone — e.g. the
 * auto-advance loop picked them up, or a previous dequeue already took
 * them — are silently skipped). Batched so a UI burst of "remove these"
 * lands as a single splice pass + one Discord message sync, instead of
 * N sequential locks each doing their own sync.
 */
export function dequeueByQids(guildId: string, qids: number[]): number {
  const s = ensure(guildId);
  if (qids.length === 0) return 0;
  const want = new Set(qids);
  const before = s.queue.length;
  s.queue = s.queue.filter((t) => !(t.qid !== undefined && want.has(t.qid)));
  return before - s.queue.length;
}

export function setLoop(guildId: string, mode: LoopMode): void {
  ensure(guildId).loop = mode;
}

/**
 * Turn autoplay on/off for a guild. Turning it off also clears the
 * "last seeded from" marker so re-enabling it later starts fresh.
 */
export function setAutoplay(guildId: string, on: boolean): void {
  const s = ensure(guildId);
  s.autoplay = on;
  if (!on) s.autoplaySeededFrom = null;
}

/**
 * Set how many recommendations the autoplay refill enqueues at once.
 * Clamped to [1, MAX_AUTOPLAY_FETCH_COUNT]; returns the value actually
 * stored. Takes effect at the next refill (already-queued recs stay).
 */
export function setAutoplayFetchCount(guildId: string, n: number): number {
  const clamped = Math.max(
    1,
    Math.min(MAX_AUTOPLAY_FETCH_COUNT, Math.floor(n)),
  );
  ensure(guildId).autoplayFetchCount = clamped;
  return clamped;
}

export function hasPrevious(guildId: string): boolean {
  return (states.get(guildId)?.history.length ?? 0) > 0;
}

function pushHistory(s: GuildState, track: Track): void {
  s.history.push(track);
  if (s.history.length > HISTORY_MAX) {
    s.history.splice(0, s.history.length - HISTORY_MAX);
  }
}

/**
 * Pop the next track per loop-mode rules. Does NOT update s.current —
 * caller must call setCurrent() after confirming playback succeeded.
 * The finishing track is pushed to `history` (unless loop='track').
 */
export function advance(guildId: string): Track | null {
  const s = ensure(guildId);
  const finished = s.current;
  if (s.loop === "track" && finished) {
    return finished;
  }
  let next = s.queue.shift() ?? null;
  if (finished) {
    pushHistory(s, finished);
    if (s.loop === "queue") {
      s.queue.push(finished);
      // Sole track on queue-loop: the just-pushed `finished` IS the
      // next track — otherwise we'd "stop" with a non-empty queue.
      if (next === null) next = s.queue.shift() ?? null;
    }
  }
  s.current = null;
  return next;
}

/**
 * Step back to the most recently played track. Pops `history`; the
 * track that was playing (if any) is pushed back to the front of the
 * queue so "next" returns to it. Does NOT update s.current — caller
 * must call setCurrent() after confirming playback succeeded. Returns
 * null when there's nothing to go back to.
 */
export function previous(guildId: string): Track | null {
  const s = ensure(guildId);
  const prev = s.history.pop() ?? null;
  if (!prev) return null;
  if (s.current) s.queue.unshift(s.current);
  s.current = null;
  return prev;
}

export function reset(guildId: string): void {
  states.delete(guildId);
}

/**
 * Drop every reference to a library track (by `trackId`) from all
 * guilds' queue / history / current — called when the track is deleted
 * so a now-missing file doesn't sit ghosted in a queue. When it was the
 * current track, `current` is nulled (the advance loop picks the next).
 * Returns how many references were removed (for logging).
 */
export function purgeTrackId(trackId: string): number {
  let removed = 0;
  for (const s of states.values()) {
    const beforeQ = s.queue.length;
    s.queue = s.queue.filter((t) => t.trackId !== trackId);
    removed += beforeQ - s.queue.length;
    const beforeH = s.history.length;
    s.history = s.history.filter((t) => t.trackId !== trackId);
    removed += beforeH - s.history.length;
    const beforeP = s.playLog.length;
    s.playLog = s.playLog.filter((e) => e.track.trackId !== trackId);
    removed += beforeP - s.playLog.length;
    if (s.current?.trackId === trackId) {
      s.current = null;
      removed += 1;
    }
    // If purging emptied this session, drop loop to "off" — otherwise the
    // advance loop never prunes a loop=track/queue state with nothing to
    // play and the bot ticks idly forever.
    if (!s.current && s.queue.length === 0) s.loop = "off";
  }
  return removed;
}
