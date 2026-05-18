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
  | "loyal";

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
} as const;

/**
 * Pick the role deck for a game of `n` players. Mirrors the Python
 * bot's tables exactly so an Avalon veteran sees no surprises.
 *
 *  4 players: Merlin + 1 evil (assassin) + 2 loyal       (4 = 1A:3B is too soft,
 *  5 players: Merlin + assassin + morgana + 2 loyal       so 4p is half-cooked
 *  6 players: Merlin + Percival + assassin + morgana + 2 loyal   in the original)
 *  7 players: Merlin + Percival + assassin + morgana + mordred + 2 loyal
 *  8–10: standard tables (see Avalon rulebook).
 */
export function rolesForPlayerCount(n: number): Position[] {
  if (n < 4 || n > 10) throw new Error(`Avalon supports 4–10 players, got ${n}`);
  // Python's original treats >=4 as starting at the all-loyal core and
  // adding red roles by group size — we keep that table verbatim.
  // [merlin, percival, assassin, morgana, mordred, oberon] are slots 1-6.
  const evilCount = n <= 6 ? 2 : n <= 9 ? 3 : 4;
  // Loyal fill: n - red - blue specials (merlin + percival).
  const hasPercival = n >= 6;
  const hasMorgana = n >= 5;
  const hasMordred = n >= 7;
  const hasOberon = n >= 10;
  const deck: Position[] = ["merlin", "assassin"]; // always present
  if (hasPercival) deck.push("percival");
  if (hasMorgana) deck.push("morgana");
  if (hasMordred) deck.push("mordred");
  if (hasOberon) deck.push("oberon");
  // Fill the rest with loyal servants.
  const blueAlready = 1 + (hasPercival ? 1 : 0); // merlin (+ percival)
  const redAlready = deck.filter((p) => ROLES[p].faction === "mordred").length;
  const sanityAssert = blueAlready + redAlready === deck.length;
  if (!sanityAssert) throw new Error("role deck math is off");
  // After this n - blueAlready - redAlready slots are loyals.
  // Cross-check red count matches the table.
  if (redAlready !== evilCount) {
    throw new Error(
      `role table mismatch: n=${n} wanted ${evilCount} evil, got ${redAlready}`,
    );
  }
  while (deck.length < n) deck.push("loyal");
  return deck;
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
