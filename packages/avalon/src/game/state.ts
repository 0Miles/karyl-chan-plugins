import { randomBytes } from "crypto";
import {
  ROLES,
  missionSize,
  round4Needs2Fail,
  rolesForPlayerCount,
  type Faction,
  type Position,
} from "./roles.js";

/**
 * Per-channel game state. One channel hosts at most one in-flight
 * Avalon session at a time; the keyed map of these lives in plugin.ts.
 *
 * Everything is in-memory only — process restart drops the game, just
 * like the original Python bot. If we ever want resume-across-restart
 * the persistence boundary is `serialize()` / `restore()` on this
 * type, but that's out of scope for v0.1.
 */

export interface Player {
  /** Discord user id. */
  userId: string;
  /** Display name captured at sign-up time so we don't re-fetch. */
  displayName: string;
  /** Seat number 1..N — stable after `deal()` shuffles. */
  index: number;
  position: Position;
  /** Most recent lake-of-the-lady check this player ran (target's userId). */
  lakeTarget: string | null;
}

export type Stage = "lobby" | "playing" | "assassinate" | "ended";
export type MissionResult = "success" | "fail";

export interface GameState {
  /** Discord guild id. */
  guildId: string;
  /** Discord channel id this game runs in. */
  channelId: string;
  /** Whoever ran `/avalon start`. Only they (or admin) can `/avalon stop`. */
  hostUserId: string;
  stage: Stage;
  /** Per-seat player roster. Order is finalised by `deal()`. */
  players: Player[];
  /** Round 1..5 (or 6 once ended). */
  round: number;
  /** Consecutive public-vote rejections this round; 5 in a row = evil wins. */
  consecutiveRejections: number;
  /** Whose turn it is to appoint mission members (seat index). */
  leaderIndex: number;
  /** Per-round outcome, populated as missions resolve. */
  missionResults: Array<MissionResult | null>;
  ladyEnabled: boolean;
  /** Seat index holding the Lady of the Lake right now (or null when disabled). */
  ladyHolderIndex: number | null;
  /** Times the lady has been used this game. */
  ladyUseCount: number;
  /** Set once the assassin has picked their target (seat index). */
  assassinTargetIndex: number | null;
  /** Final outcome when stage === 'ended'. */
  winner: Faction | null;
  /**
   * Process-unique session id. Surfaced to the WebUI so the admin
   * "force-stop" action can target a specific instance even if a new
   * session is started in the same channel right after.
   */
  sessionId: string;
  startedAt: number;
}

export function newGameState(opts: {
  guildId: string;
  channelId: string;
  hostUserId: string;
  signups: Array<{ userId: string; displayName: string }>;
  ladyEnabled: boolean;
}): GameState {
  if (opts.signups.length < 4 || opts.signups.length > 10) {
    throw new Error(`player count out of range: ${opts.signups.length}`);
  }
  const players: Player[] = opts.signups.map((s, i) => ({
    userId: s.userId,
    displayName: s.displayName,
    index: i,
    position: "loyal",
    lakeTarget: null,
  }));
  return {
    guildId: opts.guildId,
    channelId: opts.channelId,
    hostUserId: opts.hostUserId,
    stage: "lobby",
    players,
    round: 1,
    consecutiveRejections: 0,
    leaderIndex: 0,
    missionResults: [null, null, null, null, null],
    ladyEnabled: opts.ladyEnabled,
    ladyHolderIndex: null,
    ladyUseCount: 0,
    assassinTargetIndex: null,
    winner: null,
    sessionId: randomBytes(8).toString("hex"),
    startedAt: Date.now(),
  };
}

/** Fisher–Yates in-place shuffle. */
function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Assign roles + seats and pick the first leader / Lady holder.
 * Must be called exactly once, right after `newGameState`. Idempotency
 * isn't a goal — the caller is in `withChannelLock`.
 */
export function deal(state: GameState): void {
  const n = state.players.length;
  const deck = rolesForPlayerCount(n);
  shuffle(deck);
  shuffle(state.players);
  state.players.forEach((p, i) => {
    p.index = i;
    p.position = deck[i];
  });
  // First leader: random seat. Lady of the Lake (if enabled) starts in
  // the seat right *before* the first leader, per the Avalon rulebook.
  state.leaderIndex = Math.floor(Math.random() * n);
  state.ladyHolderIndex = state.ladyEnabled
    ? (state.leaderIndex + n - 1) % n
    : null;
  state.stage = "playing";
}

/** Round size for this game's current round. */
export function currentMissionSize(state: GameState): number {
  return missionSize(state.players.length, state.round);
}

/** 7+ player rule: round 4 requires 2 fail votes. */
export function currentRoundNeeds2Fail(state: GameState): boolean {
  return state.round === 4 && round4Needs2Fail(state.players.length);
}

export function playerByUserId(state: GameState, userId: string): Player | null {
  return state.players.find((p) => p.userId === userId) ?? null;
}

export function playerByIndex(state: GameState, index: number): Player | null {
  return state.players[index] ?? null;
}

export function leader(state: GameState): Player {
  const p = state.players[state.leaderIndex];
  if (!p) throw new Error("leader seat out of range");
  return p;
}

/**
 * After a mission resolves (or a public vote is rejected enough times),
 * roll the leader forward by one seat. Wraps; never assigns to the
 * Lady holder specifically — that's a separate clockwise rotation
 * triggered when the lady is used.
 */
export function rotateLeader(state: GameState): void {
  state.leaderIndex = (state.leaderIndex + 1) % state.players.length;
}

/** Drop a mission result and reset the per-round vote counters. */
export function recordMissionResult(
  state: GameState,
  result: MissionResult,
): void {
  state.missionResults[state.round - 1] = result;
  state.consecutiveRejections = 0;
  state.round++;
}

/** Compute the running tally without scanning the array twice. */
export function missionTally(state: GameState): {
  success: number;
  fail: number;
} {
  let success = 0;
  let fail = 0;
  for (const r of state.missionResults) {
    if (r === "success") success++;
    else if (r === "fail") fail++;
  }
  return { success, fail };
}

/**
 * Decide whether the game is over and, if so, why. Called after every
 * mission resolution + after the public-vote rejection counter ticks.
 */
export interface Verdict {
  ended: boolean;
  winner?: Faction;
  reason?:
    | "missions-clean"
    | "missions-then-assassinate"
    | "missions-failed"
    | "rejections"
    | "merlin-killed"
    | "merlin-survived";
}

export function evaluateVerdict(state: GameState): Verdict {
  const tally = missionTally(state);
  if (tally.fail >= 3) {
    return { ended: true, winner: "mordred", reason: "missions-failed" };
  }
  if (state.consecutiveRejections >= 5) {
    return { ended: true, winner: "mordred", reason: "rejections" };
  }
  // Three successful missions WITHOUT 4-player table (where there's
  // no assassin) ends instantly for Arthur. Otherwise Arthur "leads"
  // 3-2 but evil gets one assassinate attempt.
  if (tally.success >= 3) {
    if (state.players.length < 5) {
      return { ended: true, winner: "arthur", reason: "missions-clean" };
    }
    return { ended: false, reason: "missions-then-assassinate" };
  }
  return { ended: false };
}

/**
 * Apply the assassin's pick + decide the post-assassinate verdict.
 * Caller must already have set `state.assassinTargetIndex`.
 */
export function settleAssassinate(state: GameState): Verdict {
  if (state.assassinTargetIndex === null) {
    throw new Error("assassinate target not set");
  }
  const target = state.players[state.assassinTargetIndex];
  if (target.position === "merlin") {
    return { ended: true, winner: "mordred", reason: "merlin-killed" };
  }
  return { ended: true, winner: "arthur", reason: "merlin-survived" };
}

/** Faction for a player's role. */
export function factionOf(player: Player): Faction {
  return ROLES[player.position].faction;
}
