import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installFakeRuntime,
  resetWorldState,
  fakeClickContext,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { handleSignupClick, startSignup } from "../flow/signup.js";
import type { RoleToggles } from "../game/roles.js";

let harness: InstalledHarness;

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
});
afterEach(() => {
  resetWorldState();
});

/**
 * B-001 regression — n=4 must reject at the SIGNUP boundary so the
 * host sees the supported player range *before* clicking start. The
 * previous bug let the deck math throw deep inside deal().
 *
 * Strategy: drive a signup through the public dispatcher (handleSignupClick).
 * We need to create the signup with 4 join clicks (the host auto-joins
 * makes 5 — so we use 3 fresh joins for a total of 4 including host).
 */
async function buildSignupWith(
  playerCount: number,
  opts: { roleToggles?: RoleToggles; lakeEnabled?: boolean } = {},
): Promise<void> {
  // First message: someone has to start the signup. We can't easily
  // route through /avalon start without a full CommandContext, so we
  // simulate via an artificial first join that creates the signup. The
  // production path uses startSignup() — but for the bug we care about,
  // the minimum check fires in handleStartClick, so we use the *real*
  // sig:join clicks. The first one needs a pre-existing signup.
  //
  // Cheat: import the in-memory map and seed a signup with N players.
  const { listSignups: _ls } = await import("../flow/signup.js");
  void _ls;
  const signupModule = (await import("../flow/signup.js")) as unknown as {
    handleSignupClick: typeof handleSignupClick;
  };
  void signupModule;

  // Use the public start flow via direct map manipulation through
  // join clicks instead — but signup requires a pre-existing entry.
  // For test simplicity, we'll cheat via reflection: import the
  // private Map. handleStartClick is the surface we're actually
  // testing, so we just need *a* signup with N players.
  const internal = await import("../flow/signup.js");
  const internalMod = internal as unknown as {
    listSignups: typeof internal.listSignups;
  };
  void internalMod;
  // signups Map is private; instead use the actual flow:
  // 1. fake a "first join" by calling startSignup through a tiny
  //    CommandContext shim. We'll do it inline.
  // CommandContext requires many fields; we pass the minimum.
  const ctx = {
    pluginKey: "karyl-avalon",
    commandName: "avalon",
    subCommandName: "start",
    options: {},
    guildId: "g",
    channelId: "c-signup",
    userId: "u0",
    userDisplayName: "P0",
    voiceChannelId: null,
    capabilities: [],
    hasCapability: () => false,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    publicBaseUrl: undefined,
    botRpc: async () => null,
  } as unknown as Parameters<typeof startSignup>[0];
  await startSignup(ctx, "g", "c-signup", opts);

  for (let i = 1; i < playerCount; i++) {
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: `u${i}`,
        userDisplayName: `P${i}`,
        componentId: "sig",
        tail: "join",
      }),
      "join",
    );
  }
}

describe("B-001: signup minimum bumped to 5; 4 players should reject at signup", () => {
  it("4-player signup → host clicks start → no deal board, no game", async () => {
    await buildSignupWith(4);
    harness.resetCalls();
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u0",
        componentId: "sig",
        tail: "start",
      }),
      "start",
    );
    // Below the minimum — start is a silent no-op: no deal board sent.
    expect(harness.callsTo("messages.send").length).toBe(0);
  });
});

describe("B-001: 5-player signup → host start triggers deal + deal board send", () => {
  it("5 players → start succeeds; messages.send fires for deal board + appoint board", async () => {
    await buildSignupWith(5);
    harness.resetCalls();
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u0",
        componentId: "sig",
        tail: "start",
      }),
      "start",
    );
    const sends = harness.callsTo("messages.send");
    // At least two: deal-reveal board + the appoint board it triggers.
    expect(sends.length).toBeGreaterThanOrEqual(2);
  });
});

async function startGame(): Promise<void> {
  await handleSignupClick(
    fakeClickContext({
      channelId: "c-signup",
      userId: "u0",
      componentId: "sig",
      tail: "start",
    }),
    "start",
  );
}

describe("start options: lake opt-in flows from /avalon start", () => {
  it("default 7-player start → Lady of the Lake enabled", async () => {
    await buildSignupWith(7);
    await startGame();
    expect(getGame("c-signup")?.ladyEnabled).toBe(true);
  });
  it("lake:false on a 7-player table → Lady disabled, no button to flip", async () => {
    await buildSignupWith(7, { lakeEnabled: false });
    await startGame();
    expect(getGame("c-signup")?.ladyEnabled).toBe(false);
  });
  it("lake:true but only 6 players → Lady forced off (7+ only)", async () => {
    await buildSignupWith(6, { lakeEnabled: true });
    await startGame();
    expect(getGame("c-signup")?.ladyEnabled).toBe(false);
  });
});

describe("start options: role toggles flow into the dealt deck", () => {
  const positionsOf = (): string[] =>
    getGame("c-signup")?.players.map((p) => p.position) ?? [];

  it("default 7-player start deals every optional role", async () => {
    await buildSignupWith(7);
    await startGame();
    const positions = positionsOf();
    expect(positions).toContain("percival");
    expect(positions).toContain("morgana");
    expect(positions).toContain("mordred");
    expect(positions).not.toContain("minion");
  });

  it("morgana:false → no Morgana dealt, a Minion takes the seat", async () => {
    await buildSignupWith(7, {
      roleToggles: {
        percival: true,
        morgana: false,
        mordred: true,
        oberon: true,
      },
      lakeEnabled: true,
    });
    await startGame();
    const positions = positionsOf();
    expect(positions).not.toContain("morgana");
    expect(positions).toContain("minion");
    expect(positions).toContain("mordred");
  });

  it("percival:false → no Percival dealt, dealt as a Loyal Servant", async () => {
    await buildSignupWith(7, {
      roleToggles: {
        percival: false,
        morgana: true,
        mordred: true,
        oberon: true,
      },
      lakeEnabled: true,
    });
    await startGame();
    expect(positionsOf()).not.toContain("percival");
  });
});
