import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  click,
  installFakeRuntime,
  resetWorldState,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { openAppoint } from "../flow/stages-appoint.js";
import { openPublicVote } from "../flow/stages-publicvote.js";
import { evaluateVerdict } from "../game/state.js";

// Per TESTPLAN.md flow-006..010 — public vote behaviour around tie,
// pass→privateVote handoff, duplicate-vote guard, 5-rejection ending.

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

describe("flow-006: public-vote pass opens privateVote", () => {
  it("3 yes + 2 no on 5p → state.current.kind transitions to privateVote", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-pub-pass",
    });
    await openPublicVote(game, [0, 1]);
    expect(game.current?.kind).toBe("publicVote");
    // 3 approve, 2 reject.
    await click({ channelId: "c-pub-pass", userId: "u0", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-pass", userId: "u1", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-pass", userId: "u2", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-pass", userId: "u3", componentId: "pub", tail: "n" });
    await click({ channelId: "c-pub-pass", userId: "u4", componentId: "pub", tail: "n" });
    expect(getGame("c-pub-pass")?.current?.kind).toBe("privateVote");
  });
});

describe("flow-006b: resolved public vote reveals every player's ballot", () => {
  it("resolved board lists all 5 seats with ✅/❌ marks, no ❎", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-pub-ballots",
    });
    await openPublicVote(game, [0, 1]);
    harness.resetCalls();
    for (const [u, t] of [
      ["u0", "y"],
      ["u1", "y"],
      ["u2", "y"],
      ["u3", "n"],
      ["u4", "n"],
    ] as const) {
      await click({ channelId: "c-pub-ballots", userId: u, componentId: "pub", tail: t });
    }
    const edits = harness.callsTo("messages.edit");
    const resolved = edits[edits.length - 1].body as {
      embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
    };
    const fields = resolved.embeds[0].fields;
    const ballots = fields.find((f) => f.name.includes("投票明細"));
    expect(ballots).toBeTruthy();
    expect(ballots!.value.split("\n")).toHaveLength(5);
    expect(ballots!.value).toContain("✅ `1` P0");
    expect(ballots!.value).toContain("❌ `4` P3");
    expect(ballots!.value).not.toContain("❎");
    // The reject side of the tally also drops the old ❎ glyph.
    const result = fields.find((f) => f.name.includes("投票結果"));
    expect(result!.value).not.toContain("❎");
  });
});

describe("flow-007: public-vote tie counts as reject", () => {
  it("4-player tie 2-2 (artificially) → reject path", async () => {
    // Build a 4-player game manually to force a clean 2-2 tie. (n=4
    // role table is broken — see B-001 — so we hand-seat positions.)
    const game = buildGame({
      positions: ["merlin", "assassin", "loyal", "loyal"],
      channelId: "c-pub-tie",
    });
    await openPublicVote(game, [0, 1]);
    await click({ channelId: "c-pub-tie", userId: "u0", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-tie", userId: "u1", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-tie", userId: "u2", componentId: "pub", tail: "n" });
    await click({ channelId: "c-pub-tie", userId: "u3", componentId: "pub", tail: "n" });
    const post = getGame("c-pub-tie");
    expect(post?.consecutiveRejections).toBe(1);
    expect(post?.current?.kind).toBe("appoint"); // re-opened
  });
});

describe("flow-008: non-player public-vote click is a silent no-op", () => {
  it("clicker not in roster → vote not recorded, no ephemeral", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-pub-nonpl",
    });
    await openPublicVote(game, [0, 1]);
    harness.resetCalls();
    await click({ channelId: "c-pub-nonpl", userId: "stranger", componentId: "pub", tail: "y" });
    if (game.current?.kind === "publicVote") {
      expect(Object.keys(game.current.votes)).toHaveLength(0);
    } else {
      throw new Error("stage transitioned unexpectedly");
    }
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("flow-009: duplicate public vote is rejected", () => {
  it("same user clicks y then n → only the first sticks", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-pub-dup",
    });
    await openPublicVote(game, [0, 1]);
    await click({ channelId: "c-pub-dup", userId: "u0", componentId: "pub", tail: "y" });
    await click({ channelId: "c-pub-dup", userId: "u0", componentId: "pub", tail: "n" });
    if (game.current?.kind === "publicVote") {
      expect(game.current.votes["u0"]).toBe("yes");
      expect(Object.keys(game.current.votes)).toHaveLength(1);
    } else {
      throw new Error("stage transitioned unexpectedly");
    }
  });
});

describe("flow-010: 5 consecutive rejections ends the game (mordred)", () => {
  it("rejecting 5 cycles ends game with reasonRejections", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-pub-rej",
    });
    // Pre-set 4 prior rejections to make this fast.
    game.consecutiveRejections = 4;
    await openPublicVote(game, [0, 1]);
    // All 5 vote no.
    for (let i = 0; i < 5; i++) {
      await click({ channelId: "c-pub-rej", userId: `u${i}`, componentId: "pub", tail: "n" });
    }
    // Game should be removed from store after endGame.
    const post = getGame("c-pub-rej");
    expect(post).toBeNull();
  });
});

describe("flow-030: dispatcher drops clicks for the wrong stage", () => {
  it("clicking appt during publicVote is a silent no-op, state intact", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-stage-mix",
    });
    await openPublicVote(game, [0, 1]);
    harness.resetCalls();
    await click({ channelId: "c-stage-mix", userId: "u0", componentId: "appt", tail: "s:1" });
    // No state change, no ephemeral nag.
    expect(game.current?.kind).toBe("publicVote");
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("flow-032: per-channel lock serialises clicks", () => {
  it("10 simultaneous pub clicks on the same channel all record exactly once each", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "morgana", "loyal", "loyal",
        "loyal", "loyal", "loyal", "loyal", "loyal",
      ],
      channelId: "c-race",
    });
    await openPublicVote(game, [0, 1, 2]);
    // Fire 10 simultaneously.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        click({
          channelId: "c-race",
          userId: `u${i}`,
          componentId: "pub",
          tail: i < 6 ? "y" : "n",
        }),
      ),
    );
    // Everyone voted → resolution fired → next stage is privateVote (since 6y>4n).
    const post = getGame("c-race");
    expect(post?.current?.kind).toBe("privateVote");
  });
});

describe("openAppoint posts a board and primes state.current.appoint", () => {
  it("calling openAppoint(state) sets state.current.kind=appoint with a messageId", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-open-appt",
    });
    await openAppoint(game);
    expect(game.current?.kind).toBe("appoint");
    if (game.current?.kind === "appoint") {
      expect(game.current.messageId).toMatch(/^msg-/);
      expect(game.current.selected).toEqual([]);
    }
  });
});

describe("evaluateVerdict integration: 3 successes on 5p triggers assassinate handoff", () => {
  it("after 3 success mission records, evaluateVerdict still says not-ended but missions-then-assassinate", () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
    });
    game.missionResults = ["success", "success", "success", null, null];
    expect(evaluateVerdict(game).reason).toBe("missions-then-assassinate");
  });
});
