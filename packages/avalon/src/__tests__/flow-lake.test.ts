import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  click,
  installFakeRuntime,
  resetWorldState,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { lakeIsDueAfterRound, openLake } from "../flow/stages-lake.js";
import { buildVision } from "../game/vision.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

describe("lakeIsDueAfterRound predicate", () => {
  it("disabled → never due", () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      ladyEnabled: false,
    });
    for (const r of [1, 2, 3, 4, 5]) {
      expect(lakeIsDueAfterRound(game, r)).toBe(false);
    }
  });
  it("enabled n<7 → never due (lake requires 7+ players)", () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      ladyEnabled: true,
    });
    for (const r of [1, 2, 3, 4, 5]) {
      expect(lakeIsDueAfterRound(game, r)).toBe(false);
    }
  });
  it("enabled n=7: due after rounds 2/3/4 only", () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      ladyEnabled: true,
    });
    expect(lakeIsDueAfterRound(game, 1)).toBe(false);
    expect(lakeIsDueAfterRound(game, 2)).toBe(true);
    expect(lakeIsDueAfterRound(game, 3)).toBe(true);
    expect(lakeIsDueAfterRound(game, 4)).toBe(true);
    expect(lakeIsDueAfterRound(game, 5)).toBe(false);
  });
});

describe("flow-023/026: lake stage opens; holder gains vision on target", () => {
  it("after openLake + holder picks a loyal target, holder's vision marks them blue", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-lake-blue",
      ladyEnabled: true,
      ladyHolderIndex: 5, // a loyal
      round: 3,
    });
    await openLake(game);
    expect(game.current?.kind).toBe("lake");
    // Holder picks the percival (loyal/arthur).
    await click({ channelId: "c-lake-blue", userId: "u5", componentId: "lake", tail: "2" });
    // Token transferred to seat 2; ladyUseCount incremented.
    const post = getGame("c-lake-blue");
    expect(post?.ladyHolderIndex).toBe(2);
    expect(post?.ladyUseCount).toBe(1);
    // Original holder's vision now marks seat 2 as blue.
    const holderRow = buildVision(post!, post!.players[5])[2];
    expect(holderRow.marker).toBe("blue");
  });
});

describe("flow-027: lake refuses re-targeting a previous holder", () => {
  it("after A→B transfer, B cannot target A back", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-lake-norepeat",
      ladyEnabled: true,
      ladyHolderIndex: 5,
      round: 2,
    });
    await openLake(game);
    // 5 picks 6.
    await click({ channelId: "c-lake-norepeat", userId: "u5", componentId: "lake", tail: "6" });
    // Now seat 6 is the holder. Force open lake again at r3.
    const post = getGame("c-lake-norepeat");
    post!.round = 3;
    post!.current = null;
    await openLake(post!);
    expect(post!.current?.kind).toBe("lake");
    // Seat 6 tries to inspect seat 5 — denied.
    await click({ channelId: "c-lake-norepeat", userId: "u6", componentId: "lake", tail: "5" });
    expect(post!.current?.kind).toBe("lake"); // unchanged
    expect(post!.ladyHolderIndex).toBe(6); // still 6
  });
});

describe("flow-028: non-holder lake click is rejected", () => {
  it("non-holder click does not affect state", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-lake-stranger",
      ladyEnabled: true,
      ladyHolderIndex: 5,
      round: 2,
    });
    await openLake(game);
    harness.resetCalls();
    await click({ channelId: "c-lake-stranger", userId: "u1", componentId: "lake", tail: "2" });
    // Non-holder click is a silent no-op — stage + holder unchanged.
    expect(game.current?.kind).toBe("lake");
    expect(game.ladyHolderIndex).toBe(5);
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("lake holder cannot self-target", () => {
  it("self-tap ephemeral-rejects", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-lake-self",
      ladyEnabled: true,
      ladyHolderIndex: 5,
      round: 2,
    });
    await openLake(game);
    await click({ channelId: "c-lake-self", userId: "u5", componentId: "lake", tail: "5" });
    expect(game.ladyHolderIndex).toBe(5);
  });
});
