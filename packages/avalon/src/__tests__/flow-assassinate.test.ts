import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  click,
  installFakeRuntime,
  resetWorldState,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { openAssassinate } from "../flow/stages-assassinate.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

describe("flow-019: assassin hits Merlin → mordred wins", () => {
  it("clicking the Merlin seat ends the game with mordred winner", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-asn-hit",
    });
    await openAssassinate(game);
    await click({ channelId: "c-asn-hit", userId: "u1", componentId: "asn", tail: "0" });
    // endGame removes the channel entry.
    expect(getGame("c-asn-hit")).toBeNull();
  });
});

describe("flow-020: assassin misses Merlin → arthur wins", () => {
  it("clicking any non-merlin seat ends the game", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-asn-miss",
    });
    await openAssassinate(game);
    await click({ channelId: "c-asn-miss", userId: "u1", componentId: "asn", tail: "3" });
    expect(getGame("c-asn-miss")).toBeNull();
  });
});

describe("flow-021: non-assassin assassinate click is rejected", () => {
  it("loyal taps asn:0 → nothing changes", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-asn-nonasn",
    });
    await openAssassinate(game);
    harness.resetCalls();
    await click({ channelId: "c-asn-nonasn", userId: "u3", componentId: "asn", tail: "0" });
    // Non-assassin click is a silent no-op — game still in assassinate,
    // no ephemeral nag.
    const post = getGame("c-asn-nonasn");
    expect(post?.stage).toBe("assassinate");
    expect(post?.current?.kind).toBe("assassinate");
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("flow-022: assassin cannot self-target", () => {
  it("assassin tapping own seat ephemeral-rejects", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-asn-self",
    });
    await openAssassinate(game);
    await click({ channelId: "c-asn-self", userId: "u1", componentId: "asn", tail: "1" });
    // Game still alive — assassinTargetIndex never set.
    const post = getGame("c-asn-self");
    expect(post?.assassinTargetIndex).toBeNull();
    expect(post?.stage).toBe("assassinate");
  });
});
