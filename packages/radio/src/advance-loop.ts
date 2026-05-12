import type { Logger } from "@karyl-chan/plugin-sdk";
import { advance, getState, requeueFront, setCurrent } from "./queue.js";
import { playTrack } from "./resolver.js";
import * as nowPlaying from "./now-playing.js";

type BotRpc = (path: string, body?: unknown) => Promise<unknown | null>;

const ADVANCE_INTERVAL_MS = 5_000;

// Guilds currently being processed. A tick now does a yt-dlp stream
// resolution for lazy (playlist) tracks, which can take longer than the
// 5 s interval — without this guard a slow guild's next tick would run
// concurrently and double-play / clobber `current`.
const inFlight = new Set<string>();

/** True when this guild has nothing left to play and isn't looping. */
function isIdle(guildId: string): boolean {
  const s = getState(guildId);
  return !s || (!s.current && s.queue.length === 0 && s.loop === "off");
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
    } | null;
    if (!status) return; // RPC blip — retry next tick (state unknown; leave the message alone).
    if (!status.connected) {
      // Bot is no longer in the channel and this loop has no way to
      // re-join (that needs a user to follow). Stop ticking, drop the
      // now-playing message — keep the queue state so a fresh `/radio
      // play` resumes into it.
      seenGuilds.delete(guildId);
      await nowPlaying.teardown(guildId, botRpc).catch(() => {});
      return;
    }
    if (!status.playing) {
      const next = advance(guildId);
      if (next) {
        const outcome = await playTrack(next, (url) =>
          botRpc("/api/plugin/voice.play", { guild_id: guildId, url }),
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
      await nowPlaying.teardown(guildId, botRpc).catch(() => {});
      return;
    }
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
