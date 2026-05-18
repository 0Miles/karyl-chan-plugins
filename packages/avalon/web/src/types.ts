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
