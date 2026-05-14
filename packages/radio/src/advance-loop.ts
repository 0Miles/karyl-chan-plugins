import type { Logger } from "@karyl-chan/plugin-sdk";
import {
  type GuildState,
  type Track,
  commitCursor,
  endSession,
  enqueue,
  getCurrent,
  getPlayed,
  getUpcoming,
  getState,
  peekNext,
  removeTrackAt,
} from "./queue.js";
import {
  playTrack,
  resolveAnyTrack,
  resolveAutoplayRecommendations,
  youtubeVideoIdOf,
} from "./resolver.js";
import { doStop } from "./playback-actions.js";
import { withGuildLock } from "./guild-lock.js";
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
  const s = getState(guildId);
  const head = s ? getUpcoming(s)[0] : undefined;
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
  if (!s) return true;
  if (s.done) return true;
  if (s.loop !== "off") return false;
  // Nothing playing AND nothing upcoming.
  return !getCurrent(s) && getUpcoming(s).length === 0;
}

/** Video id to seed autoplay from: the current track's YouTube origin if
 *  it has one, else the most recently played YouTube track this session. */
function autoplaySeedVideoId(s: GuildState): string | null {
  const cur = getCurrent(s);
  const fromCurrent = cur ? youtubeVideoIdOf(cur) : null;
  if (fromCurrent) return fromCurrent;
  const played = getPlayed(s);
  for (let i = played.length - 1; i >= 0; i--) {
    const id = youtubeVideoIdOf(played[i]);
    if (id) return id;
  }
  return null;
}

/**
 * Autoplay refill: fire-on-last. When `autoplay` is on, loop is "off",
 * and the cursor is on the last track in the playlist (i.e. there is
 * nothing upcoming after it), fetch a YouTube "mix" seeded from the
 * current (or most-recent YouTube) track and append the recommendations.
 *
 * Triggered from the advance loop's tick whenever the conditions are met
 * — but `autoplaySeededFrom` records the last seed so a still-running
 * fetch or a seed that yields nothing fresh doesn't re-fire until a
 * *different* track becomes the seed. Errors are swallowed so a yt-dlp
 * hiccup doesn't break the advance loop.
 */
async function maybeAutoplayRefill(
  guildId: string,
  log: Logger,
): Promise<void> {
  const s = getState(guildId);
  if (!s || !s.autoplay || s.loop !== "off") return;
  // Fire only on the last track — autoplay is "what should play AFTER
  // this one when there's nothing queued", not "always top up".
  if (getUpcoming(s).length > 0) return;
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

  // Skip the seed itself and anything already in the playlist this
  // session — and don't repeat a video within the same batch.
  const seen = new Set<string>([seedId]);
  for (const t of s.tracks) {
    const id = youtubeVideoIdOf(t);
    if (id) seen.add(id);
  }
  const want = s.autoplayFetchCount;
  let queued = 0;
  for (const t of recs) {
    if (queued >= want) break;
    const id = youtubeVideoIdOf(t);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    // Mark provenance so the WebUI "Clear ♾️ autoplay" button can wipe
    // these without touching user-queued entries.
    t.source = "autoplay";
    enqueue(guildId, t);
    queued++;
  }
  if (queued === 0) {
    log.info("autoplay: mix had nothing fresh", { guildId, seedId });
    return;
  }
  log.info("autoplay: queued recommendations", { guildId, seedId, count: queued });
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
    // Serialize against `/radio` commands, the now-playing buttons and the
    // WebUI session routes — they all mutate this guild's queue/current
    // state across awaits, so a tick that interleaved with one of them
    // could leave the queue inconsistent (see guild-lock.ts). `inFlight`
    // above still makes a tick that arrives while this one is in progress
    // (including while it's *waiting* for the lock) skip rather than queue.
    await withGuildLock(guildId, async () => {
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
      // Auto-end the session once the bot's voice channel has been empty
      // of human listeners for EMPTY_CHANNEL_STOP_MS. `listeners`
      // undefined = "can't tell" → treat as occupied (reset the clock).
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
      // Autoplay: fire-on-last. If the current track has nothing after
      // it AND loop=off AND autoplay is on, append fresh recommendations
      // before the advance below runs. (The check is cheap when nothing
      // qualifies — autoplaySeededFrom de-bounces real fetches.)
      await maybeAutoplayRefill(guildId, log);
      if (!status.playing) {
        const candidate = peekNext(guildId);
        if (candidate) {
          // If we pre-resolved this exact entry while the last track was
          // playing, use that — no fresh yt-dlp call between songs.
          const pf = prefetched.get(guildId);
          prefetched.delete(guildId);
          const hint =
            candidate.track.needsResolve && pf && pf.url === candidate.track.url
              ? { resolved: await pf.promise }
              : undefined;
          const outcome = await playTrack(
            candidate.track,
            (url) =>
              botRpc("/api/plugin/voice.play", { guild_id: guildId, url }),
            hint,
          );
          if (outcome.ok) {
            commitCursor(guildId, candidate.idx);
          } else if (outcome.reason === "play-failed") {
            // Transient — leave the cursor where it was so the next
            // tick re-attempts the same lazy entry with a fresh resolve.
            log.warn("advance: voice.play failed, leaving cursor for retry", {
              guildId,
              url: candidate.track.url,
            });
          } else {
            // Deleted / private / region-blocked entry — drop it from the
            // playlist entirely; next tick picks whatever now sits at
            // cursor+1.
            removeTrackAt(guildId, candidate.idx);
            log.warn("advance: dropping unplayable track", {
              guildId,
              url: candidate.track.url,
            });
          }
        } else {
          // Track ended (or never started past the last one) with
          // nothing to advance to — autoplay above already had its shot
          // and didn't refill. Mark the session finished so isIdle below
          // catches it and tears down rather than ticking forever.
          endSession(guildId);
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
    });
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
      snapshot.map((guildId) =>
        processGuild(guildId, botRpc, log, seenGuilds).catch((err) => {
          log.warn("advance: processGuild errored", {
            guildId,
            err: String(err),
          });
        }),
      ),
    );
  }, ADVANCE_INTERVAL_MS);
  timer.unref();
  return timer;
}
