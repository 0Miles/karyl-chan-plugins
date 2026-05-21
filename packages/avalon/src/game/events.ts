import type { Faction, Position } from "./roles.js";
import type { GameState } from "./state.js";

/**
 * One entry in a game's history timeline — surfaced in the WebUI
 * sidebar.
 *
 * Every variant carries ONLY publicly-known information: the same
 * facts the Discord channel scrollback already shows once a stage
 * resolves. No hidden role / faction / private-ballot data lands
 * here — so the timeline is safe to hand to any viewer (seated
 * player or spectator) with no per-viewer filtering.
 *
 *  - `team-proposed`   the leader locked a mission roster (public).
 *  - `public-vote`     team-approval ballots — revealed publicly
 *                      in-game once everyone has voted.
 *  - `mission-result`  success/fail + the aggregate fail count only;
 *                      never who cast a fail ballot.
 *  - `lake-used`       who inspected whom — the revealed faction is
 *                      private to the holder and is NOT recorded.
 *  - `assassinate`     the assassin's pick + the target's now-public
 *                      role (the in-game board reveals it too).
 *  - `game-end`        winner + verdict reason.
 */
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
      targetRole: Position;
    }
  | {
      seq: number;
      at: number;
      kind: "game-end";
      winner: Faction;
      reason: string;
    };

/**
 * A `GameEvent` minus the bookkeeping fields the caller shouldn't set
 * — `recordEvent` stamps `seq` + `at`. Distributes over the union so
 * the discriminated `kind` is preserved.
 */
export type GameEventDraft = GameEvent extends infer T
  ? T extends GameEvent
    ? Omit<T, "seq" | "at">
    : never
  : never;

/**
 * Append an event to the game's timeline with a monotonic seq + a
 * wall-clock timestamp. `seq` doubles as the SSE change cursor.
 */
export function recordEvent(state: GameState, draft: GameEventDraft): void {
  // The spread widens the discriminated union back to the bare
  // object shape; the cast re-narrows it — safe because `draft` is
  // itself a `GameEvent` variant minus seq/at.
  state.events.push({
    ...draft,
    seq: state.eventSeq++,
    at: Date.now(),
  } as GameEvent);
}
