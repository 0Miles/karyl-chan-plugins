import type { Logger } from "@karyl-chan/plugin-sdk";
import { advance, getState, requeueFront, setCurrent } from "./queue.js";
import { playTrack } from "./resolver.js";

type BotRpc = (path: string, body?: unknown) => Promise<unknown | null>;

const ADVANCE_INTERVAL_MS = 5_000;

// Guilds currently being processed. A tick now does a yt-dlp stream
// resolution for lazy (playlist) tracks, which can take longer than the
// 5 s interval — without this guard a slow guild's next tick would run
// concurrently and double-play / clobber `current`.
const inFlight = new Set<string>();

async function processGuild(
  guildId: string,
  botRpc: BotRpc,
  log: Logger,
  seenGuilds: Set<string>,
): Promise<void> {
  if (inFlight.has(guildId)) return;
  inFlight.add(guildId);
  try {
    const s = getState(guildId);
    if (!s) {
      seenGuilds.delete(guildId);
      return;
    }
    if (!s.current && s.queue.length === 0 && s.loop === "off") {
      // Idle — stop ticking, but keep the GuildState: its play log is
      // the "current session" the WebUI's played-tracks list / re-queue
      // buttons act on. It's reset by `/radio stop` (or a plugin
      // restart), not by the queue running dry.
      seenGuilds.delete(guildId);
      return;
    }
    const status = (await botRpc("/api/plugin/voice.status", {
      guild_id: guildId,
    })) as { connected?: boolean; playing?: boolean } | null;
    if (!status) return; // RPC blip — retry next tick.
    if (!status.connected) {
      // Bot is no longer in the channel and this loop has no way to
      // re-join (that needs a user to follow). Stop ticking this guild
      // — keep its queue state so a fresh `/radio play` resumes into it.
      seenGuilds.delete(guildId);
      return;
    }
    if (status.playing) return;
    const next = advance(guildId);
    if (!next) return;
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
