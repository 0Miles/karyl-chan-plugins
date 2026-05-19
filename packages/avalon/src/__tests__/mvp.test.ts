import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeMvp,
  recordMvpFails,
  recordMvpProposal,
  recordMvpRejection,
  type GameState,
  type Verdict,
} from "../game/state.js";
import { buildGame, resetWorldState } from "./_harness.js";

beforeEach(() => resetWorldState());
afterEach(() => {
  resetWorldState();
  vi.restoreAllMocks();
});

function p(state: GameState, seat: number) {
  return state.players[seat];
}

describe("computeMvp: Mordred wins by assassinating Merlin", () => {
  it("returns the assassin regardless of accumulated stats", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-1",
    });
    // Even with Morgana having more fail votes, the merlin-killed
    // path is hard-coded to the assassin.
    recordMvpFails(state, { [p(state, 2).userId]: "fail" });
    recordMvpFails(state, { [p(state, 2).userId]: "fail" });
    const verdict: Verdict = {
      ended: true,
      winner: "mordred",
      reason: "merlin-killed",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 1));
  });
});

describe("computeMvp: Mordred wins via 3 mission failures", () => {
  it("returns the player with the most fail ballots", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-2",
    });
    recordMvpFails(state, { [p(state, 1).userId]: "fail" });
    recordMvpFails(state, { [p(state, 1).userId]: "fail" });
    recordMvpFails(state, { [p(state, 2).userId]: "fail" });
    const verdict: Verdict = {
      ended: true,
      winner: "mordred",
      reason: "missions-failed",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 1));
  });

  it("breaks a fail-vote tie by preferring Morgana", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-3",
    });
    recordMvpFails(state, { [p(state, 1).userId]: "fail" });
    recordMvpFails(state, { [p(state, 2).userId]: "fail" });
    const verdict: Verdict = {
      ended: true,
      winner: "mordred",
      reason: "missions-failed",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 2)); // morgana
  });

  it("falls back to random pick when no Morgana is in the tied group", () => {
    // Build a game where the two top fail-voters are assassin + minion
    // (no morgana on the table — 10p with oberon). We stub random to
    // make the pick deterministic for the assertion.
    const state = buildGame({
      positions: [
        "merlin",
        "percival",
        "assassin",
        "mordred",
        "oberon",
        "loyal",
        "loyal",
        "loyal",
        "loyal",
        "loyal",
      ],
      channelId: "c-mvp-4",
    });
    recordMvpFails(state, { [p(state, 2).userId]: "fail" }); // assassin
    recordMvpFails(state, { [p(state, 3).userId]: "fail" }); // mordred
    const verdict: Verdict = {
      ended: true,
      winner: "mordred",
      reason: "missions-failed",
    };
    // Math.random → 0 picks the first tied member.
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(computeMvp(state, verdict)).toBe(p(state, 2));
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(computeMvp(state, verdict)).toBe(p(state, 3));
  });
});

describe("computeMvp: Mordred wins via 5 rejections", () => {
  it("returns null when no player has fail votes", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-5",
    });
    const verdict: Verdict = {
      ended: true,
      winner: "mordred",
      reason: "rejections",
    };
    expect(computeMvp(state, verdict)).toBeNull();
  });
});

describe("computeMvp: Arthur win — rejected red teams - proposed red teams", () => {
  it("returns the player with the highest net rejected-vs-proposed score", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-6",
    });
    // seat 3 (loyal) rejected three red teams.
    recordMvpRejection(state, p(state, 3), [1, 3]); // contains assassin
    recordMvpRejection(state, p(state, 3), [1, 4]);
    recordMvpRejection(state, p(state, 3), [2, 4]);
    // seat 0 (merlin) rejected one red team.
    recordMvpRejection(state, p(state, 0), [1, 3]);
    // Both proposed teams without red — net stays at 3 and 1.
    const verdict: Verdict = {
      ended: true,
      winner: "arthur",
      reason: "merlin-survived",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 3));
  });

  it("counts proposed-red-team against the proposer's score", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-7",
    });
    // seat 0 rejected 2 red teams, but also proposed 2 red teams →
    // net 0.
    recordMvpRejection(state, p(state, 0), [1, 4]);
    recordMvpRejection(state, p(state, 0), [2, 4]);
    recordMvpProposal(state, p(state, 0), [1, 3]);
    recordMvpProposal(state, p(state, 0), [2, 3]);
    // seat 3 rejected 1 red team, proposed 0 → net 1.
    recordMvpRejection(state, p(state, 3), [1, 4]);
    const verdict: Verdict = {
      ended: true,
      winner: "arthur",
      reason: "merlin-survived",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 3));
  });

  it("breaks a tie by preferring Merlin", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-8",
    });
    recordMvpRejection(state, p(state, 0), [1, 4]); // merlin → +1
    recordMvpRejection(state, p(state, 3), [2, 4]); // loyal → +1
    const verdict: Verdict = {
      ended: true,
      winner: "arthur",
      reason: "merlin-survived",
    };
    expect(computeMvp(state, verdict)).toBe(p(state, 0)); // merlin
  });

  it("returns null when no player has a positive net score", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-9",
    });
    const verdict: Verdict = {
      ended: true,
      winner: "arthur",
      reason: "missions-clean",
    };
    expect(computeMvp(state, verdict)).toBeNull();
  });
});

describe("recordMvp* helpers ignore teams without red players", () => {
  it("recordMvpRejection on an all-blue team is a no-op", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-10",
    });
    recordMvpRejection(state, p(state, 0), [0, 3, 4]); // all blue
    expect(state.mvpStats.rejectedRedTeam).toEqual({});
  });

  it("recordMvpProposal on an all-blue team is a no-op", () => {
    const state = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-mvp-11",
    });
    recordMvpProposal(state, p(state, 0), [0, 3, 4]);
    expect(state.mvpStats.proposedRedTeam).toEqual({});
  });
});
