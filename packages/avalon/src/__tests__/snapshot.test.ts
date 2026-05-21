import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../game/snapshot.js";
import { recordEvent } from "../game/events.js";
import { newGameState, type GameState, type Player } from "../game/state.js";

/**
 * Deterministic 5-player game with forced roles (no random deal) so
 * the per-viewer snapshot can be asserted seat-by-seat.
 * Layout: 0=merlin, 1=percival, 2=loyal, 3=assassin, 4=morgana.
 */
function fixedGame(): GameState {
  const roles: Player["position"][] = [
    "merlin",
    "percival",
    "loyal",
    "assassin",
    "morgana",
  ];
  const state = newGameState({
    guildId: "g",
    channelId: "c",
    hostUserId: "u0",
    signups: roles.map((_r, i) => ({ userId: `u${i}`, displayName: `P${i}` })),
    ladyEnabled: false,
  });
  state.players = roles.map((position, i) => ({
    userId: `u${i}`,
    displayName: `P${i}`,
    avatarUrl: null,
    index: i,
    position,
    lakeTarget: null,
  }));
  state.stage = "playing";
  return state;
}

describe("snapshot: a seated player sees only their own role", () => {
  const game = fixedGame();
  const snap = buildSnapshot(game, "u0"); // viewer = Merlin

  it("reveals the viewer's own role + faction", () => {
    expect(snap.viewer.isPlayer).toBe(true);
    expect(snap.viewer.isSpectator).toBe(false);
    expect(snap.viewer.seat).toBe(0);
    expect(snap.viewer.role).toBe("merlin");
    expect(snap.viewer.faction).toBe("arthur");
    expect(snap.players[0].role).toBe("merlin");
  });

  it("never exposes another seat's role mid-game", () => {
    for (const seat of [1, 2, 3, 4]) {
      expect(snap.players[seat].role).toBeNull();
      expect(snap.players[seat].faction).toBeNull();
    }
  });

  it("carries vision markers from buildVision", () => {
    expect(snap.players[0].marker).toBe("self");
    // Merlin sees evil (assassin + morgana) as red.
    expect(snap.players[3].marker).toBe("red");
    expect(snap.players[4].marker).toBe("red");
    // Merlin does not see fellow good players.
    expect(snap.players[1].marker).toBe("unknown");
    expect(snap.players[2].marker).toBe("unknown");
  });
});

describe("snapshot: a spectator sees no role or vision data", () => {
  const game = fixedGame();
  const snap = buildSnapshot(game, "not-a-player");

  it("marks the viewer as a spectator", () => {
    expect(snap.viewer.isPlayer).toBe(false);
    expect(snap.viewer.isSpectator).toBe(true);
    expect(snap.viewer.seat).toBeNull();
    expect(snap.viewer.role).toBeNull();
  });

  it("hides every seat's role and gives no vision markers", () => {
    for (const p of snap.players) {
      expect(p.role).toBeNull();
      expect(p.faction).toBeNull();
      expect(p.marker).toBe("unknown");
    }
  });
});

describe("snapshot: an ended game is fully revealed to everyone", () => {
  const game = fixedGame();
  game.stage = "ended";
  game.winner = "arthur";

  it("reveals every role to a spectator once the game is over", () => {
    const snap = buildSnapshot(game, "not-a-player");
    expect(snap.players.map((p) => p.role)).toEqual([
      "merlin",
      "percival",
      "loyal",
      "assassin",
      "morgana",
    ]);
    expect(snap.players[3].faction).toBe("mordred");
  });
});

describe("snapshot: the public event timeline passes through", () => {
  it("includes recorded events verbatim", () => {
    const game = fixedGame();
    recordEvent(game, {
      kind: "mission-result",
      round: 1,
      result: "fail",
      failCount: 1,
    });
    const snap = buildSnapshot(game, "u0");
    expect(snap.events).toHaveLength(1);
    expect(snap.events[0]).toMatchObject({
      kind: "mission-result",
      round: 1,
      failCount: 1,
      seq: 0,
    });
    expect(snap.eventSeq).toBe(1);
  });
});
