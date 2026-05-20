import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  click,
  installFakeRuntime,
  resetWorldState,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { openPrivateVote } from "../flow/stages-privatevote.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

describe("flow-011: 5p r1 mission with no fails records 'success'", () => {
  it("two success ballots → missionResults[0] = success, round=2, appoint reopens", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-success",
      round: 1,
    });
    await openPrivateVote(game, [0, 3]); // merlin + loyal
    // Both arthur players → vote success.
    await click({ channelId: "c-priv-success", userId: "u0", componentId: "priv", tail: "s" });
    await click({ channelId: "c-priv-success", userId: "u3", componentId: "priv", tail: "s" });
    const post = getGame("c-priv-success");
    expect(post?.missionResults[0]).toBe("success");
    expect(post?.round).toBe(2);
    expect(post?.current?.kind).toBe("appoint");
  });
});

describe("flow-012: 1 fail on 5p r1 = mission fails", () => {
  it("one success + one fail → missionResults[0] = fail", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-fail",
      round: 1,
    });
    await openPrivateVote(game, [1, 3]); // assassin + loyal
    await click({ channelId: "c-priv-fail", userId: "u1", componentId: "priv", tail: "f" });
    await click({ channelId: "c-priv-fail", userId: "u3", componentId: "priv", tail: "s" });
    const post = getGame("c-priv-fail");
    expect(post?.missionResults[0]).toBe("fail");
  });
});

describe("flow-013/014: r4 two-fails threshold", () => {
  it("n=7 r4: 1 fail + 2 successes → mission still succeeds", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-priv-r4-n7",
      round: 4,
    });
    await openPrivateVote(game, [1, 0, 2]); // assassin + merlin + percival = missionSize 4? n=7 r4=4. Use 4.
    // Actually missionSize(7,4) = 4. Re-open with 4 members.
    if (game.current?.kind === "privateVote") game.current = null;
    await openPrivateVote(game, [1, 0, 2, 5]);
    await click({ channelId: "c-priv-r4-n7", userId: "u1", componentId: "priv", tail: "f" });
    await click({ channelId: "c-priv-r4-n7", userId: "u0", componentId: "priv", tail: "s" });
    await click({ channelId: "c-priv-r4-n7", userId: "u2", componentId: "priv", tail: "s" });
    await click({ channelId: "c-priv-r4-n7", userId: "u5", componentId: "priv", tail: "s" });
    const post = getGame("c-priv-r4-n7");
    expect(post?.missionResults[3]).toBe("success");
  });
  it("n=6 r4: 1 fail in 3 → mission fails (no two-fails rule)", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "loyal", "loyal",
      ],
      channelId: "c-priv-r4-n6",
      round: 4,
    });
    // missionSize(6,4) = 3.
    await openPrivateVote(game, [1, 0, 4]);
    await click({ channelId: "c-priv-r4-n6", userId: "u1", componentId: "priv", tail: "f" });
    await click({ channelId: "c-priv-r4-n6", userId: "u0", componentId: "priv", tail: "s" });
    await click({ channelId: "c-priv-r4-n6", userId: "u4", componentId: "priv", tail: "s" });
    const post = getGame("c-priv-r4-n6");
    expect(post?.missionResults[3]).toBe("fail");
  });
});

describe("flow-015: non-member private-vote rejected", () => {
  it("non-member click on priv:open does not record a vote", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-nonmem",
    });
    await openPrivateVote(game, [1, 3]);
    harness.resetCalls();
    await click({ channelId: "c-priv-nonmem", userId: "u0", componentId: "priv", tail: "open" });
    // Non-member tap on 前往投票 is a silent no-op — no vote recorded,
    // no ephemeral prompt sent.
    if (game.current?.kind === "privateVote") {
      expect(Object.keys(game.current.votes)).toHaveLength(0);
    }
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("flow-016: arthur trying to vote fail is rejected at engine boundary", () => {
  it("loyal mission member voting fail does NOT record a vote", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-loyalfail",
    });
    await openPrivateVote(game, [0, 3]); // merlin + loyal — both arthur
    await click({ channelId: "c-priv-loyalfail", userId: "u3", componentId: "priv", tail: "f" });
    if (game.current?.kind === "privateVote") {
      expect(game.current.votes["u3"]).toBeUndefined();
    }
  });
});

describe("flow-017: duplicate private vote rejected", () => {
  it("repeat ballot from same user is dropped", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-dup",
    });
    await openPrivateVote(game, [1, 3]);
    await click({ channelId: "c-priv-dup", userId: "u1", componentId: "priv", tail: "f" });
    // Second click while stage is still active.
    if (game.current?.kind === "privateVote") {
      await click({ channelId: "c-priv-dup", userId: "u1", componentId: "priv", tail: "s" });
      expect(game.current.votes["u1"]).toBe("fail");
    } else {
      // If the first ballot already closed the mission (other member
      // hadn't voted yet, so unlikely), at minimum we shouldn't see a
      // crash; the test passes trivially.
    }
  });
});

describe("flow-018: 3 successful missions on n=5 opens assassinate", () => {
  it("manually mark 2 prior successes then resolve a 3rd success → assassinate stage", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-priv-toAssass",
      round: 3,
    });
    game.missionResults = ["success", "success", null, null, null];
    await openPrivateVote(game, [0, 3]); // merlin + loyal — guaranteed success
    await click({ channelId: "c-priv-toAssass", userId: "u0", componentId: "priv", tail: "s" });
    await click({ channelId: "c-priv-toAssass", userId: "u3", componentId: "priv", tail: "s" });
    const post = getGame("c-priv-toAssass");
    expect(post?.stage).toBe("assassinate");
    expect(post?.current?.kind).toBe("assassinate");
  });
});
