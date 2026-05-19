import { describe, expect, it } from "vitest";
import { seatRankAmongSameRole } from "../flow/stages.js";
import type { Player } from "../game/state.js";
import type { Position } from "../game/roles.js";

function seat(i: number, position: Position): Player {
  return {
    userId: `u${i}`,
    displayName: `P${i}`,
    index: i,
    position,
    lakeTarget: null,
  };
}

describe("seatRankAmongSameRole — drives variant index for deal-reveal", () => {
  it("1-indexed by seat among same role, ascending", () => {
    const players: Player[] = [
      seat(0, "merlin"),
      seat(1, "loyal"),
      seat(2, "assassin"),
      seat(3, "loyal"),
      seat(4, "loyal"),
    ];
    expect(seatRankAmongSameRole(players, players[1])).toBe(1);
    expect(seatRankAmongSameRole(players, players[3])).toBe(2);
    expect(seatRankAmongSameRole(players, players[4])).toBe(3);
  });
  it("single-of-its-kind viewer is rank 1", () => {
    const players: Player[] = [
      seat(0, "merlin"),
      seat(1, "loyal"),
      seat(2, "assassin"),
    ];
    expect(seatRankAmongSameRole(players, players[0])).toBe(1);
    expect(seatRankAmongSameRole(players, players[2])).toBe(1);
  });
  it("returns 0 if viewer somehow isn't in same-role set (shouldn't happen)", () => {
    const players: Player[] = [seat(0, "merlin"), seat(1, "loyal")];
    const phantom = seat(99, "loyal");
    expect(seatRankAmongSameRole(players, phantom)).toBe(0);
  });
  it("respects seat index — not array order — when ranking", () => {
    // Pretend the array got rebuilt out of order at some point.
    const players: Player[] = [
      seat(2, "loyal"),
      seat(0, "loyal"),
      seat(1, "loyal"),
    ];
    expect(seatRankAmongSameRole(players, players[0])).toBe(3); // seat 2 is the highest
    expect(seatRankAmongSameRole(players, players[1])).toBe(1); // seat 0 is the lowest
    expect(seatRankAmongSameRole(players, players[2])).toBe(2);
  });
});
