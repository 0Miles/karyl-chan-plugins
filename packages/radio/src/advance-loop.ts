import type { Logger } from "@karyl-chan/plugin-sdk";
import {
  type GuildState,
  type Track,
  advance,
  enqueue,
  getState,
  requeueFront,
  setCurrent,
} from "./queue.js";
import {
  playTrack,
  resolveAnyTrack,
  resolveAutoplayRecommendations,
  youtubeVideoIdOf,
} from "./resolver.js";
import { doStop } from "./playback-actions.js";
import * as nowPlaying from "./now-playing.js";

type BotRpc = (path: string, body?: unknown) => Promise<unknown | null>;

// Poll fast so a finished track is followed up within ~1 s rather than up
// to 5 s. Cheap — `voice.status` is an in-memory lookup on the bot; the
// inFlight guard below means a tick that runs long (a yt-dlp resolve)
// just makes the next ticks skip that guild rather than pile up.
const ADVANCE_INTERVAL_MS = 1_000;

// End a session if the bot's voice channel has had no human listeners for
// this long. `lastListenerAt` maps guild → the last tick at which we saw
// ≥1 listener (or couldn't tell — we conservatively treat "unknown" as
// "someone's there" so a transient hiccup never auto-stops).
const EMPTY_CHANNEL_STOP_MS = 60_000;
const lastListenerAt = new Map<string, number>();

// Guilds currently being processed. A tick can do a yt-dlp stream
// resolution for lazy (playlist / autoplay) tracks, which takes longer
// than the tick interval — without this guard a slow guild's next tick
// would run concurrently and double-play / clobber `current`.
const inFlight = new Set<string>();

// Pre-resolved next-up track per guild: while the current track plays we
// kick off the (slow) yt-dlp resolve for `queue[0]` so it's ready the
// moment the current one ends. Keyed by guild → { the lazy entry's url,
// the in-flight/settled resolution }. Cleared when the head changes
// (url-mismatch on consume) or the session ends.
const prefetched = new Map<
  string,
  { url: string; promise: Promise<Track | null> }
>();

/** Ensure the guild's next-up lazy track is being pre-resolved. */
function ensurePrefetch(guildId: string): void {
  const head = getState(guildId)?.queue[0];
  if (!head?.needsResolve) {
    prefetched.delete(guildId);
    return;
  }
  const pf = prefetched.get(guildId);
  if (pf && pf.url === head.url) return; // already prefetching this one
  prefetched.set(guildId, {
    url: head.url,
    promise: resolveAnyTrack(head.url, head.queuedBy).catch(() => null),
  });
}

/** True when this guild has nothing left to play and isn't looping. */
function isIdle(guildId: string): boolean {
  const s = getState(guildId);
  return !s || (!s.current && s.queue.length === 0 && s.loop === "off");
}

/** Video id to seed autoplay from: the current track's YouTube origin if
 *  it has one, else the most recently played YouTube track this session. */
function autoplaySeedVideoId(s: GuildState): string | null {
  const fromCurrent = s.current ? youtubeVideoIdOf(s.current) : null;
  if (fromCurrent) return fromCurrent;
  for (let i = s.playLog.length - 1; i >= 0; i--) {
    const id = youtubeVideoIdOf(s.playLog[i].track);
    if (id) return id;
  }
  return null;
}

/**
 * Autoplay: when a guild has `autoplay` on, isn't looping, and the queue
 * is empty, fetch the YouTube "mix" radio seeded from the most recent
 * YouTube track and append the first recommendation we haven't already
 * played / queued this session. Runs *before* the advance step (so a
 * just-ended track is replaced with no gap) and also proactively while a
 * track is still playing (so the next one is queued ahead of time).
 *
 * `autoplaySeededFrom` is set to the seed id *before* the (slow) yt-dlp
 * call so a still-running fetch — or a seed that yields nothing fresh —
 * doesn't re-trigger every 5 s tick; the next refill only fires once a
 * *different* track becomes the seed. Errors are swallowed (a yt-dlp
 * hiccup must not break the advance loop).
 */
async function maybeAutoplayRefill(
  guildId: string,
  log: Logger,
): Promise<void> {
  const s = getState(guildId);
  if (!s || !s.autoplay || s.loop !== "off" || s.queue.length > 0) return;
  const seedId = autoplaySeedVideoId(s);
  if (!seedId || seedId === s.autoplaySeededFrom) return;
  s.autoplaySeededFrom = seedId;

  let recs: Track[];
  try {
    recs = await resolveAutoplayRecommendations(seedId);
  } catch (err) {
    log.warn("autoplay: mix fetch failed", {
      guildId,
      seedId,
      err: String(err),
    });
    return;
  }

  // Skip the seed itself and anything already played / queued this session.
  const seen = new Set<string>([seedId]);
  if (s.current) {
    const id = youtubeVideoIdOf(s.current);
    if (id) seen.add(id);
  }
  for (const e of s.playLog) {
    const id = youtubeVideoIdOf(e.track);
    if (id) seen.add(id);
  }
  for (const q of s.queue) {
    const id = youtubeVideoIdOf(q);
    if (id) seen.add(id);
  }
  const pick = recs.find((t) => {
    const id = youtubeVideoIdOf(t);
    return id !== null && !seen.has(id);
  });
  if (!pick) {
    log.info("autoplay: mix had nothing fresh", { guildId, seedId });
    return;
  }
  enqueue(guildId, pick);
  log.info("autoplay: queued recommendation", {
    guildId,
    seedId,
    label: pick.label,
  });
}

async function processGuild(
  guildId: string,
  botRpc: BotRpc,
  log: Logger,
  seenGuilds: Set<string>,
): Promise<void> {
  if (inFlight.has(guildId)) return;
  inFlight.add(guildId);
  try {
    // Idle / no state — the session is over (kept GuildState survives a
    // dry queue for the WebUI play-log, but the public now-playing
    // message goes away and we stop ticking).
    if (isIdle(guildId)) {
      seenGuilds.delete(guildId);
      prefetched.delete(guildId);
      await nowPlaying.teardown(guildId, botRpc).catch(() => {});
      return;
    }
    const status = (await botRpc("/api/plugin/voice.status", {
      guild_id: guildId,
    })) as {
      connected?: boolean;
      playing?: boolean;
      channelId?: string | null;
      paused?: boolean;
      listeners?: number;
    } | null;
    if (!status) return; // RPC blip — retry next tick (state unknown; leave the message alone).
    if (!status.connected) {
      // Bot is no longer in the channel and this loop has no way to
      // re-join (that needs a user to follow). Stop ticking, drop the
      // now-playing message — keep the queue state so a fresh `/radio
      // play` resumes into it.
      seenGuilds.delete(guildId);
      prefetched.delete(guildId);
      lastListenerAt.delete(guildId);
      await nowPlaying.teardown(guildId, botRpc).catch(() => {});
      return;
    }
    // Auto-end the session once the bot's voice channel has been empty of
    // human listeners for EMPTY_CHANNEL_STOP_MS. `listeners` undefined =
    // "can't tell" → treat as occupied (reset the clock).
    const now = Date.now();
    if (status.listeners === 0) {
      const since = lastListenerAt.get(guildId);
      if (since !== undefined && now - since > EMPTY_CHANNEL_STOP_MS) {
        log.info(
          "advance: voice channel empty for >1min — stopping session",
          { guildId },
        );
        seenGuilds.delete(guildId);
        prefetched.delete(guildId);
        lastListenerAt.delete(guildId);
        await doStop(guildId, botRpc).catch(() => {});
        await nowPlaying.teardown(guildId, botRpc).catch(() => {});
        return;
      }
      if (since === undefined) lastListenerAt.set(guildId, now);
    } else {
      lastListenerAt.set(guildId, now);
    }
    // Autoplay: top the queue up with a YouTube recommendation before we
    // decide what (if anything) to play next, so a just-ended track is
    // replaced seamlessly and an idle session keeps going.
    await maybeAutoplayRefill(guildId, log);
    if (!status.playing) {
      const next = advance(guildId);
      if (next) {
        // If we pre-resolved this exact entry while the last track was
        // playing, use that — no fresh yt-dlp call between songs.
        const pf = prefetched.get(guildId);
        prefetched.delete(guildId);
        const hint =
          next.needsResolve && pf && pf.url === next.url
            ? { resolved: await pf.promise }
            : undefined;
        const outcome = await playTrack(
          next,
          (url) =>
            botRpc("/api/plugin/voice.play", { guild_id: guildId, url }),
          hint,
        );
        if (outcome.ok) {
          setCurrent(guildId, outcome.track);
        } else if (outcome.reason === "play-failed") {
          // Transient — re-queue the ORIGINAL (lazy) entry so the next
          // attempt re-resolves with a fresh URL.
          requeueFront(guildId, next);
          log.warn("advance: voice.play failed, re-queued for retry", {
            guildId,
            url: next.url,
          });
        } else {
          // Deleted / private / region-blocked playlist item — drop it
          // (advance already removed it); next tick continues.
          log.warn("advance: dropping unplayable track", {
            guildId,
            url: next.url,
          });
        }
      }
    }
    // The advance above may have drained the queue — if so, the session
    // is done: tear down rather than flashing a "nothing playing" card.
    if (isIdle(guildId)) {
      seenGuilds.delete(guildId);
      prefetched.delete(guildId);
      await nowPlaying.teardown(guildId, botRpc).catch(() => {});
      return;
    }
    // Pre-resolve the (new) next-up track so the next hand-off is gapless.
    ensurePrefetch(guildId);
    // Keep the public now-playing message current (cheap — hash-gated;
    // reuses the voice status we already fetched).
    await nowPlaying.sync(guildId, botRpc, { status }).catch(() => {});
  } finally {
    inFlight.delete(guildId);
  }
}

export function startAdvanceLoop(
  botRpc: BotRpc,
  log: Logger,
  seenGuilds: Set<string>,
): NodeJS.Timeout {
  const timer = setInterval(() => {
    const snapshot = [...seenGuilds];
    void Promise.all(
      snapshot.map((guildId) => processGuild(guildId, botRpc, log, seenGuilds)),
    );
  }, ADVANCE_INTERVAL_MS);
  timer.unref();
  return timer;
}
