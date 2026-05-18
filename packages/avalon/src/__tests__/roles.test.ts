import { describe, expect, it } from "vitest";
import {
  ROLES,
  missionSize,
  round4Needs2Fail,
  rolesForPlayerCount,
  type Position,
} from "../game/roles.js";

// Tests are indexed against TESTPLAN.md — keep the row ids in sync if
// you add or rename a case so BUGS.md's "test that caught it" pointers
// don't rot.

describe("roles-002..007: rolesForPlayerCount decks (5..10)", () => {
  // 4-player table is currently broken (see B-001 / roles-001) — its
  // own test lives in a separate describe so it can be xfail'd without
  // hiding the other rows.
  const expectations: Record<number, Position[]> = {
    5: ["merlin", "assassin", "morgana", "loyal", "loyal"],
    6: ["merlin", "assassin", "percival", "morgana", "loyal", "loyal"],
    7: [
      "merlin",
      "assassin",
      "percival",
      "morgana",
      "mordred",
      "loyal",
      "loyal",
    ],
    8: [
      "merlin",
      "assassin",
      "percival",
      "morgana",
      "mordred",
      "loyal",
      "loyal",
      "loyal",
    ],
    9: [
      "merlin",
      "assassin",
      "percival",
      "morgana",
      "mordred",
      "loyal",
      "loyal",
      "loyal",
      "loyal",
    ],
    10: [
      "merlin",
      "assassin",
      "percival",
      "morgana",
      "mordred",
      "oberon",
      "loyal",
      "loyal",
      "loyal",
      "loyal",
    ],
  };

  for (const [n, deck] of Object.entries(expectations)) {
    it(`n=${n} deck content (sorted-equal)`, () => {
      const actual = rolesForPlayerCount(Number(n));
      // Sort-equal: order inside the array is the *deal-deck* order and
      // is shuffled before assignment anyway; assert by frequency.
      expect([...actual].sort()).toEqual([...deck].sort());
      expect(actual.length).toBe(Number(n));
    });
  }

  it("n=5..10 evil count matches the rulebook table", () => {
    const evilFreq = (positions: Position[]): number =>
      positions.filter((p) => ROLES[p].faction === "mordred").length;
    expect(evilFreq(rolesForPlayerCount(5))).toBe(2);
    expect(evilFreq(rolesForPlayerCount(6))).toBe(2);
    expect(evilFreq(rolesForPlayerCount(7))).toBe(3);
    expect(evilFreq(rolesForPlayerCount(8))).toBe(3);
    expect(evilFreq(rolesForPlayerCount(9))).toBe(3);
    expect(evilFreq(rolesForPlayerCount(10))).toBe(4);
  });
});

describe("roles-001: n=4 is rejected at the boundary (currently throws by accident — B-001)", () => {
  // The intended behaviour: n=4 should EITHER yield a 1-evil deck OR be
  // rejected with a clear "supports 5-10" message at the signup boundary
  // (so the host learns BEFORE clicking start). Today rolesForPlayerCount
  // throws a 「role table mismatch」 string deep inside deal() — that's
  // surfaced to the host via dispatcher.ts's catch-all ephemeral nudge
  // but leaves the signup hung. See B-001.
  //
  // For now we assert the *current* behaviour so the test catches a
  // regression in either direction. When B-001 is fixed the assertion
  // flips to either: deck === [merlin,assassin,loyal,loyal] OR throws
  // "Avalon supports 5-10 players, got 4".
  it("currently throws role-table-mismatch on n=4", () => {
    expect(() => rolesForPlayerCount(4)).toThrowError(/n=4/);
  });
});

describe("roles-008: n<4 / n>10 rejected", () => {
  it("n=3 throws", () => {
    expect(() => rolesForPlayerCount(3)).toThrowError(/4–10 players/);
  });
  it("n=11 throws", () => {
    expect(() => rolesForPlayerCount(11)).toThrowError(/4–10 players/);
  });
});

describe("roles-009/010: missionSize", () => {
  it("missionSize(7, 4) === 4", () => {
    expect(missionSize(7, 4)).toBe(4);
  });
  it("missionSize covers every (n,round) in the printed rulebook", () => {
    const table: Record<number, number[]> = {
      5: [2, 3, 2, 3, 3],
      6: [2, 3, 4, 3, 4],
      7: [2, 3, 3, 4, 4],
      8: [3, 4, 4, 5, 5],
      9: [3, 4, 4, 5, 5],
      10: [3, 4, 4, 5, 5],
    };
    for (const [n, sizes] of Object.entries(table)) {
      for (let r = 1; r <= 5; r++) {
        expect(missionSize(Number(n), r)).toBe(sizes[r - 1]);
      }
    }
  });
  it("round-out-of-range throws", () => {
    expect(() => missionSize(5, 0)).toThrow();
    expect(() => missionSize(5, 6)).toThrow();
  });
  it("unsupported player count throws", () => {
    expect(() => missionSize(3, 1)).toThrow();
    expect(() => missionSize(11, 1)).toThrow();
  });
});

describe("roles-011: r4 two-fails threshold is n>=7", () => {
  it.each([
    [5, false],
    [6, false],
    [7, true],
    [8, true],
    [9, true],
    [10, true],
  ])("round4Needs2Fail(%i) === %s", (n, expected) => {
    expect(round4Needs2Fail(n)).toBe(expected);
  });
});

describe("roles-012: faction membership in ROLES", () => {
  it("merlin/percival/loyal are arthur", () => {
    expect(ROLES.merlin.faction).toBe("arthur");
    expect(ROLES.percival.faction).toBe("arthur");
    expect(ROLES.loyal.faction).toBe("arthur");
  });
  it("assassin/morgana/mordred/oberon are mordred", () => {
    expect(ROLES.assassin.faction).toBe("mordred");
    expect(ROLES.morgana.faction).toBe("mordred");
    expect(ROLES.mordred.faction).toBe("mordred");
    expect(ROLES.oberon.faction).toBe("mordred");
  });
});
