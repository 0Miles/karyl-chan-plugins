export interface Track {
  label: string;
  queuedBy?: string;
  queuedByName?: string;
  trackId?: string;
  /**
   * Stable queue-entry id (assigned server-side at enqueue). The unified
   * id used by /dequeue, /jump and /reorder; also the v-for :key for
   * playlist rendering. Present on every playlist track.
   */
  qid: number;
  coverUrl?: string;
  sourceUrl?: string;
  /** Library metadata, present when the queue entry came from the downloaded library. */
  author?: string;
  album?: string;
  duration?: number;
  /** Present (and equal to "autoplay") only when the entry was appended
   *  by the autoplay refill — the WebUI's "Clear ♾️ autoplay" button
   *  enables when any track carries this. User-queued entries omit it. */
  source?: "autoplay";
}

export type LoopMode = "off" | "track" | "queue";

export interface SessionSnapshot {
  guildId: string;
  channelId: string | null;
  paused: boolean;
  loop: LoopMode;
  autoplay: boolean;
  autoplayFetchCount: number;
  /** Full ordered playlist. Partition around `cursorQid` to render
   *  played / current / upcoming. */
  playlist: Track[];
  /** qid of the currently-playing track; null when idle. */
  cursorQid: number | null;
}
