import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_TOGGLES,
  ROLES,
  missionSize,
  round4Needs2Fail,
  rolesForPlayerCount,
  type Position,
  type RoleToggles,
} from "../game/roles.js";

// Tests are indexed against TESTPLAN.md — keep the row ids in sync if
// you add or rename a case so BUGS.md's "test that caught it" pointers
// don't rot.

describe("roles-002..007: rolesForPlayerCount decks (5..10), all roles on", () => {
  // Default toggles (every optional role enabled) — Percival now joins
  // from 5 players up, paired with Morgana per the rulebook.
  const expectations: Record<number, Position[]> = {
    5: ["merlin", "percival", "assassin", "morgana", "loyal"],
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

describe("roles-001: n=4 yields a valid deck (B-001 resolved)", () => {
  // The old slot-math threw 「role table mismatch」 deep inside deal()
  // on n=4. The slot-based builder no longer can: every seat resolves
  // to a concrete role. n=4 is still unreachable through signup
  // (MIN_PLAYERS = 5) but the engine no longer blows up on it.
  it("n=4 deck is 2 good + 2 evil with no throw", () => {
    const deck = rolesForPlayerCount(4);
    expect([...deck].sort()).toEqual(
      ["merlin", "percival", "assassin", "morgana"].sort(),
    );
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

describe("roles-013: role toggles replace specials with powerless stand-ins", () => {
  const freq = (deck: Position[], pos: Position): number =>
    deck.filter((p) => p === pos).length;
  const off = (over: Partial<RoleToggles>): RoleToggles => ({
    ...DEFAULT_ROLE_TOGGLES,
    ...over,
  });

  it("percival off ⇒ a Loyal Servant takes the slot, no Percival", () => {
    const deck = rolesForPlayerCount(7, off({ percival: false }));
    expect(freq(deck, "percival")).toBe(0);
    expect(freq(deck, "loyal")).toBe(3); // was 2 + Percival's seat
  });

  it("morgana off at n=5 ⇒ a Minion takes the slot", () => {
    const deck = rolesForPlayerCount(5, off({ morgana: false }));
    expect([...deck].sort()).toEqual(
      ["merlin", "percival", "loyal", "assassin", "minion"].sort(),
    );
  });

  it("mordred off at n=7 ⇒ Minion fills it; Oberon stays out of a 7p deck", () => {
    const deck = rolesForPlayerCount(7, off({ mordred: false }));
    expect(freq(deck, "mordred")).toBe(0);
    expect(freq(deck, "oberon")).toBe(0); // Oberon's slot opens only at 10
    expect(freq(deck, "minion")).toBe(1);
  });

  it("oberon off at n=10 ⇒ Minion fills it", () => {
    const deck = rolesForPlayerCount(10, off({ oberon: false }));
    expect(freq(deck, "oberon")).toBe(0);
    expect(freq(deck, "minion")).toBe(1);
  });

  it("every special off ⇒ only Merlin + Assassin keep their powers", () => {
    const deck = rolesForPlayerCount(10, {
      percival: false,
      morgana: false,
      mordred: false,
      oberon: false,
    });
    expect(freq(deck, "merlin")).toBe(1);
    expect(freq(deck, "assassin")).toBe(1);
    expect(freq(deck, "loyal")).toBe(5);
    expect(freq(deck, "minion")).toBe(3);
  });

  it("toggles never change the good/evil split", () => {
    for (let n = 5; n <= 10; n++) {
      const deck = rolesForPlayerCount(n, {
        percival: false,
        morgana: false,
        mordred: false,
        oberon: false,
      });
      const evil = deck.filter((p) => ROLES[p].faction === "mordred").length;
      const expected = n <= 6 ? 2 : n <= 9 ? 3 : 4;
      expect(evil).toBe(expected);
    }
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
