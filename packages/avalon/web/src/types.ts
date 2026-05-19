export interface GameSnapshot {
  channelId: string;
  guildId: string;
  hostUserId: string;
  sessionId: string;
  stage: string;
  currentStage: string | null;
  round: number;
  playerCount: number;
  consecutiveRejections: number;
  ladyEnabled: boolean;
  startedAt: number;
}

export interface SignupSnapshot {
  channelId: string;
  guildId: string;
  hostUserId: string;
  hostDisplayName: string;
  playerCount: number;
}

export interface GamesResponse {
  games: GameSnapshot[];
  signups: SignupSnapshot[];
}

export type RolePosition =
  | "merlin"
  | "percival"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "loyal"
  // Pre-staged for the Minion-of-Mordred deck slot; the backend
  // accepts uploads for these slots but the role isn't yet dealt
  // in any rolesForPlayerCount config.
  | "minion";

export interface RoleArtEntry {
  position: RolePosition;
  /** Present only for variant positions (loyal / minion); 1-indexed. */
  variant?: number;
  filename: string;
  size: number;
  url: string;
}

/** Game-element assets — non-role uploaded art (e.g. Lake-of-the-Lady token). */
export type AssetKey = "lake";

export interface AssetEntry {
  assetKey: AssetKey;
  filename: string;
  size: number;
  url: string;
}

export interface ArtResponse {
  art: RoleArtEntry[];
  assets: AssetEntry[];
}
