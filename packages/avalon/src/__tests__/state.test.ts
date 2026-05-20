import { describe, expect, it } from "vitest";
import {
  deal,
  evaluateVerdict,
  factionOf,
  newGameState,
  recordMissionResult,
  rotateLeader,
  settleAssassinate,
  type GameState,
  type Player,
} from "../game/state.js";

function fivePlayerGame(): GameState {
  const game = newGameState({
    guildId: "g",
    channelId: "c",
    hostUserId: "u0",
    signups: Array.from({ length: 5 }, (_, i) => ({
      userId: `u${i}`,
      displayName: `P${i}`,
    })),
    ladyEnabled: false,
  });
  deal(game);
  return game;
}

function buildGameWithSeats(
  seats: Player["position"][],
  opts: { ladyEnabled?: boolean } = {},
): GameState {
  const game = newGameState({
    guildId: "g",
    channelId: "c",
    hostUserId: "u0",
    signups: seats.map((_p, i) => ({
      userId: `u${i}`,
      displayName: `P${i}`,
    })),
    ladyEnabled: opts.ladyEnabled ?? false,
  });
  // Skip deal to keep positions deterministic; manually seat each role.
  game.players = seats.map((position, i) => ({
    userId: `u${i}`,
    displayName: `P${i}`,
    index: i,
    position,
    lakeTarget: null,
  }));
  game.stage = "playing";
  return game;
}

describe("state-001: 3 fails ends game with mordred", () => {
  it("verdict for [fail,fail,fail,null,null]", () => {
    const game = fivePlayerGame();
    game.missionResults = ["fail", "fail", "fail", null, null];
    const verdict = evaluateVerdict(game);
    expect(verdict.ended).toBe(true);
    expect(verdict.winner).toBe("mordred");
    expect(verdict.reason).toBe("missions-failed");
  });
});

describe("state-002: 5 consecutive rejections ends game", () => {
  it("verdict triggers on rejections>=5", () => {
    const game = fivePlayerGame();
    game.consecutiveRejections = 5;
    const verdict = evaluateVerdict(game);
    expect(verdict.ended).toBe(true);
    expect(verdict.winner).toBe("mordred");
    expect(verdict.reason).toBe("rejections");
  });
  it("rejections=4 does not end the game", () => {
    const game = fivePlayerGame();
    game.consecutiveRejections = 4;
    expect(evaluateVerdict(game).ended).toBe(false);
  });
});

describe("state-003: 3 successes on 5+ player table opens assassinate handoff", () => {
  it("yields missions-then-assassinate, NOT ended", () => {
    const game = fivePlayerGame();
    game.missionResults = ["success", "success", "success", null, null];
    const verdict = evaluateVerdict(game);
    expect(verdict.ended).toBe(false);
    expect(verdict.reason).toBe("missions-then-assassinate");
  });
});

describe("state-004: 3 successes on a 4-player table = immediate arthur win", () => {
  it("verdict ends with missions-clean (n<5)", () => {
    // Manually build a 4-player table — newGameState allows it and we
    // don't need the deck to actually be valid for this test.
    const game = buildGameWithSeats([
      "merlin",
      "assassin",
      "loyal",
      "loyal",
    ]);
    game.missionResults = ["success", "success", "success", null, null];
    const verdict = evaluateVerdict(game);
    expect(verdict.ended).toBe(true);
    expect(verdict.winner).toBe("arthur");
    expect(verdict.reason).toBe("missions-clean");
  });
});

describe("state-005/006: settleAssassinate", () => {
  it("hitting merlin → mordred wins", () => {
    const game = buildGameWithSeats([
      "merlin",
      "assassin",
      "morgana",
      "loyal",
      "loyal",
    ]);
    game.assassinTargetIndex = 0; // merlin's seat
    const verdict = settleAssassinate(game);
    expect(verdict.ended).toBe(true);
    expect(verdict.winner).toBe("mordred");
    expect(verdict.reason).toBe("merlin-killed");
  });
  it("missing merlin (loyal) → arthur wins", () => {
    const game = buildGameWithSeats([
      "merlin",
      "assassin",
      "morgana",
      "loyal",
      "loyal",
    ]);
    game.assassinTargetIndex = 3; // a loyal seat
    const verdict = settleAssassinate(game);
    expect(verdict.ended).toBe(true);
    expect(verdict.winner).toBe("arthur");
    expect(verdict.reason).toBe("merlin-survived");
  });
});

describe("state-007: settleAssassinate without target throws", () => {
  it("throws when assassinTargetIndex is null", () => {
    const game = fivePlayerGame();
    game.assassinTargetIndex = null;
    expect(() => settleAssassinate(game)).toThrow();
  });
});

describe("state-008: rotateLeader wraps", () => {
  it("from last seat wraps to seat 0", () => {
    const game = fivePlayerGame();
    game.leaderIndex = game.players.length - 1;
    rotateLeader(game);
    expect(game.leaderIndex).toBe(0);
  });
});

describe("state-009: recordMissionResult ticks round, zeroes rejections", () => {
  it("after a recorded round, rejections=0 and round bumps", () => {
    const game = fivePlayerGame();
    game.consecutiveRejections = 3;
    game.round = 2;
    recordMissionResult(game, "success");
    expect(game.consecutiveRejections).toBe(0);
    expect(game.round).toBe(3);
    expect(game.missionResults[1]).toBe("success");
  });
});

describe("state-010: deal assigns each role exactly once", () => {
  it("freq of dealt deck matches rolesForPlayerCount", () => {
    const game = fivePlayerGame();
    const dealt = game.players.map((p) => p.position).sort();
    expect(dealt).toEqual(
      ["assassin", "loyal", "merlin", "morgana", "percival"].sort(),
    );
  });
});

describe("state-013: newGameState rejects <4 or >10", () => {
  it("throws on 3 signups", () => {
    expect(() =>
      newGameState({
        guildId: "g",
        channelId: "c",
        hostUserId: "u0",
        signups: Array.from({ length: 3 }, (_, i) => ({
          userId: `u${i}`,
          displayName: `P${i}`,
        })),
        ladyEnabled: false,
      }),
    ).toThrow();
  });
  it("throws on 11 signups", () => {
    expect(() =>
      newGameState({
        guildId: "g",
        channelId: "c",
        hostUserId: "u0",
        signups: Array.from({ length: 11 }, (_, i) => ({
          userId: `u${i}`,
          displayName: `P${i}`,
        })),
        ladyEnabled: false,
      }),
    ).toThrow();
  });
});

describe("state-014: verdict ordering — fail count beats rejections", () => {
  it("fail>=3 wins even when rejections>=5 happens to also be true", () => {
    const game = fivePlayerGame();
    game.missionResults = ["fail", "fail", "fail", null, null];
    game.consecutiveRejections = 5;
    const verdict = evaluateVerdict(game);
    // Failures are checked first; the game would have ended at the
    // third fail before rejections could reach 5 in real play, but
    // the predicate must be stable regardless.
    expect(verdict.reason).toBe("missions-failed");
  });
});

describe("factionOf reflects ROLES table", () => {
  it("merlin → arthur, assassin → mordred", () => {
    const game = buildGameWithSeats([
      "merlin",
      "assassin",
      "loyal",
      "loyal",
      "morgana",
    ]);
    expect(factionOf(game.players[0])).toBe("arthur");
    expect(factionOf(game.players[1])).toBe("mordred");
    expect(factionOf(game.players[2])).toBe("arthur");
    expect(factionOf(game.players[4])).toBe("mordred");
  });
});
