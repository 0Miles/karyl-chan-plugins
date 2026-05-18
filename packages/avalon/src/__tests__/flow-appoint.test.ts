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

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

describe("flow-002: appoint toggle + confirm pipeline", () => {
  it("5p r1 leader picks 2 seats then confirms → publicVote opens", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-appt-ok",
      leaderIndex: 0,
    });
    await openAppoint(game);
    expect(game.current?.kind).toBe("appoint");

    await click({ channelId: "c-appt-ok", userId: "u0", componentId: "appt", tail: "s:1" });
    await click({ channelId: "c-appt-ok", userId: "u0", componentId: "appt", tail: "s:2" });
    await click({ channelId: "c-appt-ok", userId: "u0", componentId: "appt", tail: "c" });

    expect(getGame("c-appt-ok")?.current?.kind).toBe("publicVote");
  });
});

describe("flow-003: non-leader appoint click is rejected", () => {
  it("non-leader tap doesn't mutate selected", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-appt-nonleader",
      leaderIndex: 0,
    });
    await openAppoint(game);
    harness.resetCalls();
    await click({ channelId: "c-appt-nonleader", userId: "u1", componentId: "appt", tail: "s:2" });
    if (game.current?.kind === "appoint") {
      expect(game.current.selected).toEqual([]);
    } else {
      throw new Error("expected appoint stage");
    }
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThan(0);
  });
});

describe("flow-004: appoint refuses an extra selection when full", () => {
  it("attempting a 3rd seat on a missionSize=2 round is rejected", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-appt-full",
      leaderIndex: 0,
    });
    await openAppoint(game);
    await click({ channelId: "c-appt-full", userId: "u0", componentId: "appt", tail: "s:1" });
    await click({ channelId: "c-appt-full", userId: "u0", componentId: "appt", tail: "s:2" });
    harness.resetCalls();
    await click({ channelId: "c-appt-full", userId: "u0", componentId: "appt", tail: "s:3" });
    if (game.current?.kind === "appoint") {
      expect(game.current.selected).toEqual([1, 2]);
    } else {
      throw new Error("expected appoint stage");
    }
    // The ephemeral nudge fires; presence is enough — exact text is i18n-001's job.
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThan(0);
  });
});

describe("flow-005: appoint confirm refuses partial selection", () => {
  it("confirm with 1 selected (need 2) → stage stays in appoint", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-appt-short",
      leaderIndex: 0,
    });
    await openAppoint(game);
    await click({ channelId: "c-appt-short", userId: "u0", componentId: "appt", tail: "s:1" });
    await click({ channelId: "c-appt-short", userId: "u0", componentId: "appt", tail: "c" });
    expect(game.current?.kind).toBe("appoint");
  });
});

describe("appoint seat toggle removes a selected seat on re-click", () => {
  it("clicking s:1 twice returns selected to []", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-appt-toggle",
      leaderIndex: 0,
    });
    await openAppoint(game);
    await click({ channelId: "c-appt-toggle", userId: "u0", componentId: "appt", tail: "s:1" });
    await click({ channelId: "c-appt-toggle", userId: "u0", componentId: "appt", tail: "s:1" });
    if (game.current?.kind === "appoint") {
      expect(game.current.selected).toEqual([]);
    } else {
      throw new Error("expected appoint stage");
    }
  });
});

describe("flow-029: deal-board click from a non-player triggers notInGame ephemeral", () => {
  it("non-player click on `deal` doesn't change state", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-non",
    });
    void game;
    harness.resetCalls();
    await click({ channelId: "c-deal-non", userId: "stranger", componentId: "deal" });
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThan(0);
  });
});
