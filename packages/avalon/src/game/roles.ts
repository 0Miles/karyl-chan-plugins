/**
 * Avalon role catalogue.
 *
 * Faction membership and "what each role sees" are encoded here so the
 * dealer + the vision-rendering code stay in lockstep. Adding a role
 * variant later (Lancelot, etc.) means extending this map; the rest of
 * the engine reads roles via the helpers.
 */

import type { LocaleKey } from "../i18n/zh-TW.js";

export type Position =
  | "merlin"
  | "percival"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "loyal"
  // Plain Minion of Mordred — a powerless evil role.
  | "minion";

export type Faction = "arthur" | "mordred";

export interface RoleSpec {
  position: Position;
  faction: Faction;
  /** i18n key for the display name. */
  nameKey: LocaleKey;
}

export const ROLES: Record<Position, RoleSpec> = {
  merlin: { position: "merlin", faction: "arthur", nameKey: "role.merlin" },
  percival: {
    position: "percival",
    faction: "arthur",
    nameKey: "role.percival",
  },
  assassin: {
    position: "assassin",
    faction: "mordred",
    nameKey: "role.assassin",
  },
  morgana: {
    position: "morgana",
    faction: "mordred",
    nameKey: "role.morgana",
  },
  mordred: {
    position: "mordred",
    faction: "mordred",
    nameKey: "role.mordred",
  },
  oberon: { position: "oberon", faction: "mordred", nameKey: "role.oberon" },
  loyal: { position: "loyal", faction: "arthur", nameKey: "role.loyal" },
  minion: { position: "minion", faction: "mordred", nameKey: "role.minion" },
} as const;

/**
 * Optional special roles a host can switch on/off at `/avalon start`.
 * All default to `true`; a role switched off is replaced in the deck
 * by a powerless stand-in (Loyal Servant for Percival, Minion of
 * Mordred for the evil specials).
 */
export interface RoleToggles {
  /** Morgana — appears to Percival as Merlin. Off ⇒ a plain Minion. */
  morgana: boolean;
  /** Percival — sees Merlin + Morgana. Off ⇒ a plain Loyal Servant. */
  percival: boolean;
  /** Mordred — hidden from Merlin. Off ⇒ a plain Minion. */
  mordred: boolean;
  /** Oberon — isolated from the other evils. Off ⇒ a plain Minion. */
  oberon: boolean;
}

/**
 * Every optional role enabled — the `/avalon start` default. Frozen:
 * it is aliased by reference into every default GameState, so an
 * accidental field write would rewrite the rulebook process-wide.
 */
export const DEFAULT_ROLE_TOGGLES: RoleToggles = Object.freeze({
  morgana: true,
  percival: true,
  mordred: true,
  oberon: true,
});

/**
 * Evil specials in the order they claim the non-Assassin evil seats as
 * the table grows: Morgana (5+ players), Mordred (7+), Oberon (10).
 * `rolesForPlayerCount` walks this list up to `evilCount - 1` entries.
 */
const RED_SPECIAL_PRIORITY = ["morgana", "mordred", "oberon"] as const;

/**
 * Pick the role deck for a game of `n` players.
 *
 * The deck is built by seat *slots*: Merlin + Assassin are fixed, then
 * each remaining seat is a slot that — depending on player count — a
 * special role is eligible to claim. A slot whose role is toggled off
 * (or whose count threshold isn't met) holds a powerless stand-in
 * instead: Loyal Servant on the blue side, Minion of Mordred on red.
 *
 *  5–6 players: 2 evil  → Assassin + [Morgana]
 *  7–9 players: 3 evil  → Assassin + [Morgana, Mordred]
 *  10 players : 4 evil  → Assassin + [Morgana, Mordred, Oberon]
 *
 * Blue side always carries Merlin; the first non-Merlin seat is
 * Percival's slot. Remaining seats are Loyal Servants.
 */
export function rolesForPlayerCount(
  n: number,
  toggles: RoleToggles = DEFAULT_ROLE_TOGGLES,
): Position[] {
  if (n < 4 || n > 10) throw new Error(`Avalon supports 4–10 players, got ${n}`);
  const evilCount = n <= 6 ? 2 : n <= 9 ? 3 : 4;
  const goodCount = n - evilCount;

  const blue: Position[] = ["merlin"];
  if (goodCount >= 2) blue.push(toggles.percival ? "percival" : "loyal");
  while (blue.length < goodCount) blue.push("loyal");

  // Assassin already holds one evil seat, so only evilCount - 1 remain.
  const red: Position[] = ["assassin"];
  for (let i = 0; i < evilCount - 1; i++) {
    const special = RED_SPECIAL_PRIORITY[i];
    red.push(toggles[special] ? special : "minion");
  }

  return [...blue, ...red];
}

/**
 * Mission size table. Indexed by `[playerCount - 4][round - 1]`.
 * Round 4 in a 7+ player game requires TWO failure votes — encoded
 * separately via `round4Needs2Fail`.
 */
const MISSION_SIZE: Record<number, [number, number, number, number, number]> = {
  4: [2, 3, 2, 3, 3],
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

export function missionSize(playerCount: number, round: number): number {
  const table = MISSION_SIZE[playerCount];
  if (!table) throw new Error(`unsupported player count: ${playerCount}`);
  if (round < 1 || round > 5) throw new Error(`round out of range: ${round}`);
  return table[round - 1];
}

/** 7-player rule: round 4 requires 2 fail votes. */
export function round4Needs2Fail(playerCount: number): boolean {
  return playerCount >= 7;
}
