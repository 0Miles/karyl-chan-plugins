import { describe, expect, it } from "vitest";
import { buildVision } from "../game/vision.js";
import {
  deal,
  newGameState,
  type GameState,
  type Player,
} from "../game/state.js";

// Helper: build a deterministic 7-player game where we *force* the
// role at each seat instead of dealing randomly. Lets vision tests run
// without Math.random surprises.
function fixedGame(roles: Player["position"][]): GameState {
  const state = newGameState({
    guildId: "g",
    channelId: "c",
    hostUserId: "u0",
    signups: roles.map((_r, i) => ({
      userId: `u${i}`,
      displayName: `P${i}`,
    })),
    ladyEnabled: false,
  });
  // Bypass deal() — assign positions in roster order so the test reads
  // straight off the array.
  state.players = roles.map((position, i) => ({
    userId: `u${i}`,
    displayName: `P${i}`,
    index: i,
    position,
    lakeTarget: null,
  }));
  state.stage = "playing";
  return state;
}

describe("vision-001..003: Merlin sees evil except Mordred", () => {
  // Layout: 0=merlin, 1=assassin, 2=morgana, 3=mordred, 4=oberon,
  // 5=percival, 6=loyal.
  const game = fixedGame([
    "merlin",
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "percival",
    "loyal",
  ]);
  const merlin = game.players[0];

  it("sees assassin/morgana/oberon as red", () => {
    const rows = buildVision(game, merlin);
    expect(rows[1].marker).toBe("red");
    expect(rows[2].marker).toBe("red");
    expect(rows[4].marker).toBe("red");
  });
  it("does NOT see Mordred as red", () => {
    const rows = buildVision(game, merlin);
    expect(rows[3].marker).toBe("unknown");
  });
  it("does not see other arthur players", () => {
    const rows = buildVision(game, merlin);
    expect(rows[5].marker).toBe("unknown"); // percival
    expect(rows[6].marker).toBe("unknown"); // loyal
  });
  it("marks self as self", () => {
    const rows = buildVision(game, merlin);
    expect(rows[0].marker).toBe("self");
  });
});

describe("vision-004..005: Percival sees Merlin AND Morgana as purple", () => {
  const game = fixedGame([
    "percival",
    "merlin",
    "morgana",
    "assassin",
    "loyal",
  ]);
  const percival = game.players[0];

  it("sees merlin & morgana purple, others unknown", () => {
    const rows = buildVision(game, percival);
    expect(rows[1].marker).toBe("purple"); // merlin
    expect(rows[2].marker).toBe("purple"); // morgana
    expect(rows[3].marker).toBe("unknown"); // assassin
    expect(rows[4].marker).toBe("unknown"); // loyal
  });
});

describe("vision-006: Evil sees other evil except Oberon", () => {
  const game = fixedGame([
    "assassin",
    "morgana",
    "mordred",
    "oberon",
    "merlin",
    "loyal",
    "percival",
  ]);
  const assassin = game.players[0];

  it("assassin sees morgana & mordred red, oberon NOT", () => {
    const rows = buildVision(game, assassin);
    expect(rows[1].marker).toBe("red"); // morgana
    expect(rows[2].marker).toBe("red"); // mordred
    expect(rows[3].marker).toBe("unknown"); // oberon — invisible to teammates
  });
  it("assassin does not see arthur players", () => {
    const rows = buildVision(game, assassin);
    expect(rows[4].marker).toBe("unknown"); // merlin
    expect(rows[5].marker).toBe("unknown"); // loyal
    expect(rows[6].marker).toBe("unknown"); // percival
  });
});

describe("vision-007: Oberon sees nothing", () => {
  const game = fixedGame([
    "oberon",
    "assassin",
    "morgana",
    "mordred",
    "merlin",
    "loyal",
    "percival",
  ]);
  const oberon = game.players[0];

  it("every other seat is unknown", () => {
    const rows = buildVision(game, oberon);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].marker).toBe("unknown");
    }
  });
});

describe("vision-008: Loyal sees nothing", () => {
  const game = fixedGame(["loyal", "merlin", "assassin", "morgana", "percival"]);
  const loyal = game.players[0];

  it("every other seat is unknown", () => {
    const rows = buildVision(game, loyal);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].marker).toBe("unknown");
    }
  });
});

describe("vision-010/011: Lake override beats role vision", () => {
  const game = fixedGame(["merlin", "loyal", "morgana", "percival", "assassin"]);
  const merlin = game.players[0];

  it("checking a loyal target shows blue", () => {
    merlin.lakeTarget = game.players[1].userId; // loyal
    const rows = buildVision(game, merlin);
    expect(rows[1].marker).toBe("blue");
  });
  it("checking an evil target shows red even if role-vision would already say red", () => {
    merlin.lakeTarget = game.players[2].userId; // morgana — merlin sees as red anyway
    const rows = buildVision(game, merlin);
    expect(rows[2].marker).toBe("red");
  });
  it("checking an evil target previously hidden by role-vision exposes them", () => {
    // Loyal viewer who lake-checked an assassin → sees red even though
    // loyal vision normally returns unknown.
    const game2 = fixedGame(["loyal", "assassin", "merlin", "morgana"]);
    const loyal = game2.players[0];
    loyal.lakeTarget = game2.players[1].userId;
    const rows = buildVision(game2, loyal);
    expect(rows[1].marker).toBe("red");
  });
});

describe("vision-009: seat numbering", () => {
  it("seat starts at 1, not 0", () => {
    const game = fixedGame(["loyal", "merlin", "morgana", "assassin"]);
    const rows = buildVision(game, game.players[0]);
    expect(rows.map((r) => r.seat)).toEqual([1, 2, 3, 4]);
  });
});

describe("deal() randomisation respects ladyEnabled", () => {
  it("deal(state) sets ladyHolderIndex to (leader-1) % n when enabled", () => {
    const game = newGameState({
      guildId: "g",
      channelId: "c",
      hostUserId: "u0",
      signups: Array.from({ length: 7 }, (_, i) => ({
        userId: `u${i}`,
        displayName: `P${i}`,
      })),
      ladyEnabled: true,
    });
    deal(game);
    expect(game.ladyHolderIndex).toBe(
      (game.leaderIndex + game.players.length - 1) % game.players.length,
    );
  });
  it("deal(state) leaves ladyHolderIndex null when disabled", () => {
    const game = newGameState({
      guildId: "g",
      channelId: "c",
      hostUserId: "u0",
      signups: Array.from({ length: 7 }, (_, i) => ({
        userId: `u${i}`,
        displayName: `P${i}`,
      })),
      ladyEnabled: false,
    });
    deal(game);
    expect(game.ladyHolderIndex).toBeNull();
  });
});
