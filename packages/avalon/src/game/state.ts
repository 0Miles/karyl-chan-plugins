import { randomBytes } from "crypto";
import {
  DEFAULT_ROLE_TOGGLES,
  ROLES,
  missionSize,
  round4Needs2Fail,
  rolesForPlayerCount,
  type Faction,
  type Position,
  type RoleToggles,
} from "./roles.js";
import type { GameEvent } from "./events.js";

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

/**
 * Per-stage transient state. One channel runs one stage at a time, so a
 * discriminated union keyed by `kind` is cleaner than parallel maps.
 * Each variant carries the message id of the public board it owns
 * (so the handler can edit-in-place on every click) plus the
 * stage-specific tallies. Cleared when the stage advances.
 */
export type RuntimeStage =
  | {
      kind: "appoint";
      messageId: string;
      /** Seat indexes the leader has tapped so far. */
      selected: number[];
    }
  | {
      kind: "publicVote";
      messageId: string;
      /** Mission roster (seat indexes) chosen during appoint. */
      missionMembers: number[];
      /** userId → vote. */
      votes: Record<string, "yes" | "no">;
    }
  | {
      kind: "privateVote";
      /** The mission roster announcement message. */
      messageId: string;
      missionMembers: number[];
      /** userId → vote. */
      votes: Record<string, "success" | "fail">;
    }
  | {
      kind: "lake";
      messageId: string;
      /** Seat index of the current Lady holder (= state.ladyHolderIndex when stage opens). */
      holderIndex: number;
    }
  | {
      kind: "assassinate";
      messageId: string;
    };

export interface GameState {
  /** Discord guild id. */
  guildId: string;
  /** Discord channel id this game runs in. */
  channelId: string;
  /** Whoever ran `/avalon start`. Only they (or admin) can `/avalon stop`. */
  hostUserId: string;
  stage: Stage;
  /**
   * Transient stage runtime. Set by the stage opener, mutated by its
   * click handlers, cleared (or replaced) when the stage advances.
   * Distinct from `stage` (lobby/playing/assassinate/ended) which is
   * the high-level lifecycle marker; multiple `current.kind`s fit
   * inside `stage="playing"`.
   */
  current: RuntimeStage | null;
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
  /**
   * Optional special roles in play, fixed at `/avalon start` time.
   * `deal()` feeds this to `rolesForPlayerCount` so a toggled-off role
   * is replaced by a powerless stand-in.
   */
  roleToggles: RoleToggles;
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
  /**
   * Per-player tallies used at end-of-game to pick the MVP (the
   * "decisive figure" whose card face is featured on the ending
   * embed). Mutated by the public/private-vote handlers + the
   * appoint confirmation site; consumed only by `computeMvp`.
   * Missing entries default to 0.
   */
  mvpStats: MvpStats;
  /**
   * Public history timeline — appended by `recordEvent` as stages
   * resolve, consumed by the WebUI sidebar. Holds only public-safe
   * facts (see `events.ts`). `eventSeq` is the monotonic id source
   * and doubles as the SSE change cursor.
   */
  events: GameEvent[];
  eventSeq: number;
}

export interface MvpStats {
  /** Times this player cast a `fail` ballot on a mission. */
  failVotes: Record<string, number>;
  /**
   * Times this player rejected (`no`) a public proposal whose
   * mission roster included at least one Mordred-faction member.
   * Ground truth — recorded server-side; the player may or may not
   * have known the team contained a red player.
   */
  rejectedRedTeam: Record<string, number>;
  /**
   * Times this player, as leader, confirmed a mission roster that
   * included at least one Mordred-faction member. Subtracted from
   * `rejectedRedTeam` at MVP time so a leader who keeps proposing
   * red teams doesn't farm Arthur-side MVP off their own rejections.
   */
  proposedRedTeam: Record<string, number>;
}

export function newGameState(opts: {
  guildId: string;
  channelId: string;
  hostUserId: string;
  signups: Array<{ userId: string; displayName: string }>;
  ladyEnabled: boolean;
  /** Optional special roles; defaults to all enabled. */
  roleToggles?: RoleToggles;
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
    current: null,
    players,
    round: 1,
    consecutiveRejections: 0,
    leaderIndex: 0,
    missionResults: [null, null, null, null, null],
    ladyEnabled: opts.ladyEnabled,
    roleToggles: opts.roleToggles ?? DEFAULT_ROLE_TOGGLES,
    ladyHolderIndex: null,
    ladyUseCount: 0,
    assassinTargetIndex: null,
    winner: null,
    sessionId: randomBytes(8).toString("hex"),
    startedAt: Date.now(),
    mvpStats: {
      failVotes: {},
      rejectedRedTeam: {},
      proposedRedTeam: {},
    },
    events: [],
    eventSeq: 0,
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
  const deck = rolesForPlayerCount(n, state.roleToggles);
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

/**
 * Synthetic NPC users carry an `npc:<n>` userId. They occupy real seats
 * with real Player records but never own a Discord interaction token —
 * the NPC driver mutates their `votes` / `selected` / etc. directly
 * instead of routing through the click handlers.
 */
export const NPC_USERID_PREFIX = "npc:";
export function isNpcUserId(userId: string): boolean {
  return userId.startsWith(NPC_USERID_PREFIX);
}
export function isNpc(player: Player): boolean {
  return isNpcUserId(player.userId);
}

// ── MVP scoring ──────────────────────────────────────────────────

function teamHasRed(state: GameState, missionMembers: number[]): boolean {
  for (const seat of missionMembers) {
    const p = state.players[seat];
    if (p && factionOf(p) === "mordred") return true;
  }
  return false;
}

/**
 * Increment a leader's "proposed a red team" counter when they
 * confirm a mission roster containing at least one Mordred-faction
 * member. Used to discount Arthur-side MVP for someone who farms
 * rejections by also proposing dubious teams themselves.
 */
export function recordMvpProposal(
  state: GameState,
  leader: Player,
  missionMembers: number[],
): void {
  if (!teamHasRed(state, missionMembers)) return;
  state.mvpStats.proposedRedTeam[leader.userId] =
    (state.mvpStats.proposedRedTeam[leader.userId] ?? 0) + 1;
}

/**
 * Count a public-vote rejection of a team containing at least one
 * Mordred-faction member. Drives the Arthur-side MVP score.
 */
export function recordMvpRejection(
  state: GameState,
  voter: Player,
  missionMembers: number[],
): void {
  if (!teamHasRed(state, missionMembers)) return;
  state.mvpStats.rejectedRedTeam[voter.userId] =
    (state.mvpStats.rejectedRedTeam[voter.userId] ?? 0) + 1;
}

/**
 * Count every `fail` ballot cast on a private mission vote. Called
 * once per mission resolution, before state.current is cleared.
 */
export function recordMvpFails(
  state: GameState,
  votes: Record<string, "success" | "fail">,
): void {
  for (const [userId, ballot] of Object.entries(votes)) {
    if (ballot === "fail") {
      state.mvpStats.failVotes[userId] =
        (state.mvpStats.failVotes[userId] ?? 0) + 1;
    }
  }
}

/**
 * Pick the most-valuable player for the just-ended game:
 *
 *  • merlin-killed → the assassin (comeback shot trumps stats).
 *  • Mordred otherwise → max fail-vote count; tied group breaks
 *    by Morgana > random.
 *  • Arthur → max (rejectedRedTeam − proposedRedTeam); tied group
 *    breaks by Merlin > random.
 *
 * Returns null when no player had a non-zero contribution — e.g.
 * the 5-reject loss where no missions ran.
 */
export function computeMvp(state: GameState, verdict: Verdict): Player | null {
  if (!verdict.ended || !verdict.winner) return null;
  if (verdict.reason === "merlin-killed") {
    return state.players.find((p) => p.position === "assassin") ?? null;
  }
  if (verdict.winner === "mordred") {
    return mvpTieBreak(
      state,
      (p) => state.mvpStats.failVotes[p.userId] ?? 0,
      "morgana",
    );
  }
  return mvpTieBreak(
    state,
    (p) =>
      (state.mvpStats.rejectedRedTeam[p.userId] ?? 0) -
      (state.mvpStats.proposedRedTeam[p.userId] ?? 0),
    "merlin",
  );
}

function mvpTieBreak(
  state: GameState,
  scoreFn: (p: Player) => number,
  preferred: Position,
): Player | null {
  let max = -Infinity;
  for (const p of state.players) {
    const s = scoreFn(p);
    if (s > max) max = s;
  }
  // Below-or-equal-zero max → nobody contributed; no MVP.
  if (max <= 0) return null;
  const tied = state.players.filter((p) => scoreFn(p) === max);
  if (tied.length === 0) return null;
  const preferredPick = tied.find((p) => p.position === preferred);
  if (preferredPick) return preferredPick;
  return tied[Math.floor(Math.random() * tied.length)] ?? null;
}
