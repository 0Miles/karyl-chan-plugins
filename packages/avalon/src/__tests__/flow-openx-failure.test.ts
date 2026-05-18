import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  installFakeRuntime,
  resetWorldState,
  type InstalledHarness,
} from "./_harness.js";
import { openAppoint } from "../flow/stages-appoint.js";
import { openPublicVote } from "../flow/stages-publicvote.js";
import { openPrivateVote } from "../flow/stages-privatevote.js";
import { openLake } from "../flow/stages-lake.js";
import { openAssassinate } from "../flow/stages-assassinate.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
  harness.forceSendFailure(true);
});
afterEach(() => {
  resetWorldState();
});

/**
 * B-016 regression — when messages.send returns null (rate limit /
 * outage / missing permission), each open* used to early-return
 * silently. The host had no signal beyond a stage that never opened.
 *
 * Fix: every openX now log.errors with the stage tag + channel +
 * round before bailing.
 */

describe("B-016: open* paths log.error when messages.send returns null", () => {
  it("openAppoint logs an error tagged with channel+round", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-fail-appt",
      round: 2,
    });
    await openAppoint(game);
    // No state.current populated.
    expect(game.current).toBeNull();
    const errs = harness.logsAt("error", "appoint");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].meta?.channelId).toBe("c-fail-appt");
  });
  it("openPublicVote logs an error", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-fail-pub",
    });
    await openPublicVote(game, [0, 1]);
    expect(game.current).toBeNull();
    expect(harness.logsAt("error", "publicVote").length).toBeGreaterThan(0);
  });
  it("openPrivateVote logs an error", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-fail-priv",
    });
    await openPrivateVote(game, [0, 1]);
    expect(game.current).toBeNull();
    expect(harness.logsAt("error", "privateVote").length).toBeGreaterThan(0);
  });
  it("openLake logs an error", async () => {
    const game = buildGame({
      positions: [
        "merlin", "assassin", "percival", "morgana", "mordred", "loyal", "loyal",
      ],
      channelId: "c-fail-lake",
      ladyEnabled: true,
      ladyHolderIndex: 5,
      round: 2,
    });
    await openLake(game);
    expect(game.current).toBeNull();
    expect(harness.logsAt("error", "lake").length).toBeGreaterThan(0);
  });
  it("openAssassinate logs an error", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-fail-asn",
    });
    await openAssassinate(game);
    expect(game.current).toBeNull();
    expect(harness.logsAt("error", "assassinate").length).toBeGreaterThan(0);
  });
});
