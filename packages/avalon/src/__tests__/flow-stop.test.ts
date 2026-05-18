import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  installFakeRuntime,
  resetWorldState,
  type InstalledHarness,
} from "./_harness.js";
import { openPublicVote } from "../flow/stages-publicvote.js";
import { openAppoint } from "../flow/stages-appoint.js";
import { clearCurrentStageButtons } from "../flow/stop.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

/**
 * B-002 regression — /avalon stop (and the WebUI force-stop) must strip
 * buttons from the currently-active stage board so players don't see
 * live-looking buttons in the channel after the host force-ends the
 * game.
 */
describe("B-002: clearCurrentStageButtons strips components from the active stage message", () => {
  it("calling on a game in publicVote → messages.edit with components: []", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-stop-pub",
    });
    await openPublicVote(game, [0, 1]);
    expect(game.current?.kind).toBe("publicVote");
    harness.resetCalls();
    await clearCurrentStageButtons(game);
    const edits = harness.callsTo("messages.edit");
    expect(edits.length).toBe(1);
    const body = edits[0].body as { components?: unknown[] };
    expect(body.components).toEqual([]);
  });
  it("calling on a game in appoint → messages.edit fired", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-stop-appt",
    });
    await openAppoint(game);
    harness.resetCalls();
    await clearCurrentStageButtons(game);
    expect(harness.callsTo("messages.edit").length).toBe(1);
  });
  it("calling on a game with no current sub-stage is a no-op", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-stop-noop",
    });
    game.current = null;
    harness.resetCalls();
    await clearCurrentStageButtons(game);
    expect(harness.callsTo("messages.edit").length).toBe(0);
  });
});
