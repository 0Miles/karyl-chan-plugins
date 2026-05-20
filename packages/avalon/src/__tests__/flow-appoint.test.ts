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
    // Non-leader click is a silent no-op — selection unchanged, and no
    // ephemeral nag is sent.
    if (game.current?.kind === "appoint") {
      expect(game.current.selected).toEqual([]);
    } else {
      throw new Error("expected appoint stage");
    }
    expect(harness.callsTo("interactions.followup").length).toBe(0);
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
    // At capacity — the extra tap is a silent no-op (no ephemeral nag).
    if (game.current?.kind === "appoint") {
      expect(game.current.selected).toEqual([1, 2]);
    } else {
      throw new Error("expected appoint stage");
    }
    expect(harness.callsTo("interactions.followup").length).toBe(0);
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

describe("flow-029: deal-board click from a non-player is a silent no-op", () => {
  it("non-player click on `deal` sends no followup", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-non",
    });
    void game;
    harness.resetCalls();
    await click({ channelId: "c-deal-non", userId: "stranger", componentId: "deal" });
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});

describe("flow-040: deal reveal ephemeral carries the role-help button", () => {
  it("seated player click → followup body has a components row with deal:help", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-help-1",
    });
    void game;
    harness.resetCalls();
    await click({ channelId: "c-deal-help-1", userId: "u0", componentId: "deal" });
    const followups = harness.callsTo("interactions.followup");
    expect(followups.length).toBeGreaterThan(0);
    const body = followups[followups.length - 1].body as {
      components?: Array<{ components: Array<{ custom_id?: string }> }>;
    };
    expect(body.components).toBeTruthy();
    const ids = (body.components ?? []).flatMap((row) =>
      row.components.map((c) => c.custom_id ?? ""),
    );
    expect(ids).toContain("kc:karyl-avalon:deal:help");
  });
});

describe("flow-041: deal:help renders a role-description embed", () => {
  it("percival viewer's help ephemeral includes the purple marker line", async () => {
    const game = buildGame({
      positions: ["merlin", "percival", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-help-3",
    });
    void game;
    harness.resetCalls();
    await click({
      channelId: "c-deal-help-3",
      userId: "u1", // percival
      componentId: "deal",
      tail: "help",
    });
    const body = harness
      .callsTo("interactions.followup")[0]
      .body as {
        embeds?: Array<{ fields?: Array<{ value: string }> }>;
      };
    const markerLines = body.embeds?.[0]?.fields?.[0]?.value ?? "";
    expect(markerLines).toContain("🟣");
    expect(markerLines).toContain("梅林或莫甘娜");
  });
  it("loyal viewer's help ephemeral has self + unknown markers ONLY", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-help-4",
    });
    void game;
    harness.resetCalls();
    await click({
      channelId: "c-deal-help-4",
      userId: "u3", // loyal
      componentId: "deal",
      tail: "help",
    });
    const body = harness
      .callsTo("interactions.followup")[0]
      .body as {
        embeds?: Array<{ fields?: Array<{ value: string }> }>;
      };
    const markerLines = body.embeds?.[0]?.fields?.[0]?.value ?? "";
    expect(markerLines).toContain("👤");
    expect(markerLines).toContain("⬜");
    expect(markerLines).not.toContain("🔴");
    expect(markerLines).not.toContain("🟣");
  });
  it("non-player help click is a silent no-op", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-deal-help-5",
    });
    void game;
    harness.resetCalls();
    await click({
      channelId: "c-deal-help-5",
      userId: "stranger",
      componentId: "deal",
      tail: "help",
    });
    expect(harness.callsTo("interactions.followup").length).toBe(0);
  });
});
