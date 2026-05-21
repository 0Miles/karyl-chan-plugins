// Browser-side mirror of the backend per-viewer snapshot
// (src/game/snapshot.ts) and event timeline (src/game/events.ts).
// Kept structurally in sync by hand — the two files are small and
// the WebUI build would fail loudly on a mismatch.

export type RolePosition =
  | "merlin"
  | "percival"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "loyal"
  | "minion";

export type Faction = "arthur" | "mordred";

export type VisionMarker = "red" | "blue" | "purple" | "self" | "unknown";

export interface PlayerView {
  seat: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  isNpc: boolean;
  isLeader: boolean;
  isLadyHolder: boolean;
  onMission: boolean;
  marker: VisionMarker;
  role: RolePosition | null;
  faction: Faction | null;
}

export type GameEvent =
  | {
      seq: number;
      at: number;
      kind: "team-proposed";
      round: number;
      leaderSeat: number;
      memberSeats: number[];
    }
  | {
      seq: number;
      at: number;
      kind: "public-vote";
      round: number;
      approved: boolean;
      yes: number;
      no: number;
      ballots: Array<{ seat: number; vote: "yes" | "no" }>;
    }
  | {
      seq: number;
      at: number;
      kind: "mission-result";
      round: number;
      result: "success" | "fail";
      failCount: number;
    }
  | {
      seq: number;
      at: number;
      kind: "lake-used";
      holderSeat: number;
      targetSeat: number;
    }
  | {
      seq: number;
      at: number;
      kind: "assassinate";
      assassinSeat: number;
      targetSeat: number;
      targetRole: RolePosition;
    }
  | {
      seq: number;
      at: number;
      kind: "game-end";
      winner: Faction;
      reason: string;
    };

export interface GameSnapshotView {
  channelId: string;
  guildId: string;
  sessionId: string;
  stage: "lobby" | "playing" | "assassinate" | "ended";
  currentStage: string | null;
  round: number;
  missionResults: Array<"success" | "fail" | null>;
  missionSizes: number[];
  consecutiveRejections: number;
  leaderSeat: number;
  ladyEnabled: boolean;
  ladyHolderSeat: number | null;
  winner: Faction | null;
  endReason: string | null;
  startedAt: number;
  players: PlayerView[];
  viewer: {
    seat: number | null;
    isPlayer: boolean;
    isSpectator: boolean;
    role: RolePosition | null;
    faction: Faction | null;
  };
  events: GameEvent[];
  eventSeq: number;
}

/** The terminal frame the SSE stream / state route emit when a game is gone. */
export interface GoneSnapshot {
  gone: true;
}

/** Payload of the public GET /api/manual endpoint. */
export interface ManualData {
  intro: string;
  rules: Array<{ title: string; body: string }>;
  roles: Array<{
    position: RolePosition;
    name: string;
    faction: Faction;
    /** One-line flavour. */
    short: string;
    /** Full description — multi-paragraph. */
    detail: string;
  }>;
}
