/**
 * Per-viewer game snapshot — the JSON the WebUI game board renders.
 *
 * This is the single security boundary for the WebUI: it is built
 * once per viewer and decides exactly what that viewer is allowed to
 * know. The rules:
 *
 *  - A seated player sees their OWN role/faction, plus a vision
 *    marker for every other seat computed by `buildVision` (the same
 *    rulebook the in-channel deal-reveal uses) — never another
 *    seat's actual role.
 *  - A spectator (token holder who isn't seated) sees no roles, no
 *    factions and no vision markers at all.
 *  - Once the game has ended, every seat's role/faction is revealed
 *    to everyone — the in-channel ending board already does this.
 *
 * `events` is the public timeline and is safe for any viewer as-is
 * (see `events.ts`).
 */

import {
  factionOf,
  isNpc,
  playerByUserId,
  type GameState,
  type Stage,
} from "./state.js";
import { missionSize, type Faction, type Position } from "./roles.js";
import { buildVision, type VisionMarker } from "./vision.js";
import type { GameEvent } from "./events.js";

export interface PlayerView {
  /** 0-based seat index. */
  seat: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isNpc: boolean;
  isLeader: boolean;
  isLadyHolder: boolean;
  /** On the roster of the mission currently being appointed/voted. */
  onMission: boolean;
  /** Viewer's vision of this seat. "unknown" for spectators. */
  marker: VisionMarker;
  /** Revealed role — own seat (player) or all seats post-game; else null. */
  role: Position | null;
  faction: Faction | null;
}

export interface GameSnapshotView {
  channelId: string;
  guildId: string;
  sessionId: string;
  stage: Stage;
  currentStage: string | null;
  round: number;
  /** Per-round outcome so far (success/fail/null), rounds 1..5. */
  missionResults: Array<"success" | "fail" | null>;
  /** Mission roster size per round 1..5 for this player count. */
  missionSizes: number[];
  consecutiveRejections: number;
  leaderSeat: number;
  ladyEnabled: boolean;
  ladyHolderSeat: number | null;
  winner: Faction | null;
  endReason: string | null;
  startedAt: number;
  players: PlayerView[];
  /** Who is looking — drives the "your role card" panel. */
  viewer: {
    seat: number | null;
    isPlayer: boolean;
    isSpectator: boolean;
    role: Position | null;
    faction: Faction | null;
  };
  events: GameEvent[];
  /** Monotonic change cursor — also the SSE ordering key. */
  eventSeq: number;
}

/** Is `seat` on the mission roster the current stage is working on? */
function isOnMission(state: GameState, seat: number): boolean {
  const cur = state.current;
  if (!cur) return false;
  if (cur.kind === "appoint") return cur.selected.includes(seat);
  if (cur.kind === "publicVote" || cur.kind === "privateVote") {
    return cur.missionMembers.includes(seat);
  }
  return false;
}

/**
 * Build the snapshot a specific viewer is allowed to see. `viewerId`
 * is the Discord user id from the verified session token; a viewer
 * who isn't a seated player is treated as a spectator.
 */
export function buildSnapshot(
  state: GameState,
  viewerId: string,
): GameSnapshotView {
  const viewer = playerByUserId(state, viewerId);
  const ended = state.stage === "ended";
  // Vision rows only exist for a seated player in a live game.
  const visionRows = viewer && !ended ? buildVision(state, viewer) : null;

  const players: PlayerView[] = state.players.map((p) => {
    const isSelf = viewer !== null && p.userId === viewer.userId;
    // Reveal a seat's true role when: the game is over (public
    // reveal), or it's the viewer's own seat.
    const revealRole = ended || isSelf;
    let marker: VisionMarker;
    if (isSelf) {
      marker = "self";
    } else if (ended) {
      marker = factionOf(p) === "mordred" ? "red" : "blue";
    } else if (visionRows) {
      marker = visionRows[p.index]?.marker ?? "unknown";
    } else {
      marker = "unknown";
    }
    return {
      seat: p.index,
      userId: p.userId,
      displayName: p.displayName,
      avatarUrl: p.avatarUrl,
      isNpc: isNpc(p),
      isLeader: p.index === state.leaderIndex,
      isLadyHolder: state.ladyHolderIndex === p.index,
      onMission: isOnMission(state, p.index),
      marker,
      role: revealRole ? p.position : null,
      faction: revealRole ? factionOf(p) : null,
    };
  });

  const missionSizes = [1, 2, 3, 4, 5].map((r) =>
    missionSize(state.players.length, r),
  );

  return {
    channelId: state.channelId,
    guildId: state.guildId,
    sessionId: state.sessionId,
    stage: state.stage,
    currentStage: state.current?.kind ?? null,
    round: state.round,
    missionResults: state.missionResults,
    missionSizes,
    consecutiveRejections: state.consecutiveRejections,
    leaderSeat: state.leaderIndex,
    ladyEnabled: state.ladyEnabled,
    ladyHolderSeat: state.ladyHolderIndex,
    winner: state.winner,
    endReason: ended ? lastEndReason(state) : null,
    startedAt: state.startedAt,
    players,
    viewer: {
      seat: viewer?.index ?? null,
      isPlayer: viewer !== null,
      isSpectator: viewer === null,
      role: viewer ? viewer.position : null,
      faction: viewer ? factionOf(viewer) : null,
    },
    events: state.events,
    eventSeq: state.eventSeq,
  };
}

/** Pull the verdict reason out of the recorded `game-end` event. */
function lastEndReason(state: GameState): string | null {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const ev = state.events[i];
    if (ev.kind === "game-end") return ev.reason;
  }
  return null;
}
