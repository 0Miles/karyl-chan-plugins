export interface Track {
  label: string;
  queuedBy?: string;
  queuedByName?: string;
  trackId?: string;
  /**
   * Stable queue-entry id (assigned server-side at enqueue). Lets the WebUI
   * remove an item by identity, not by volatile array index — so optimistic
   * hiding and batched dequeues stay correct under concurrent advances.
   * Absent on `current` / `played` entries that have already left the queue.
   */
  qid?: number;
  coverUrl?: string;
  sourceUrl?: string;
  /** Library metadata, present when the queue entry came from the downloaded library. */
  author?: string;
  album?: string;
  duration?: number;
}

export interface PlayedTrack extends Track {
  seq: number;
}

export type LoopMode = "off" | "track" | "queue";

export interface SessionSnapshot {
  guildId: string;
  channelId: string | null;
  paused: boolean;
  loop: LoopMode;
  autoplay: boolean;
  autoplayFetchCount: number;
  current: Track | null;
  queue: Track[];
  queueLength: number;
  hasPrev: boolean;
  played: PlayedTrack[];
}

export interface LibraryTrack {
  id: string;
  title: string;
  author?: string;
  album?: string;
  duration?: number;
  sizeBytes?: number;
  coverUrl?: string;
  sourceUrl?: string;
}

export interface LibraryListResponse {
  tracks: LibraryTrack[];
}
