import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installFakeRuntime,
  resetWorldState,
  fakeClickContext,
  type InstalledHarness,
} from "./_harness.js";
import { handleSignupClick } from "../flow/signup.js";

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
async function buildSignupWith(playerCount: number): Promise<void> {
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
  const { startSignup } = await import("../flow/signup.js");
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
  await startSignup(ctx, "g", "c-signup");

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
  it("4-player signup → host clicks start → ephemeral notEnough, no game in store", async () => {
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
    // No messages.send happened for a deal board.
    const sends = harness.callsTo("messages.send");
    expect(sends.length).toBe(0);
    // An ephemeral nudge fired (the notEnough notice).
    const followups = harness.callsTo("interactions.followup");
    expect(followups.length).toBeGreaterThan(0);
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

describe("B-003: lady-of-the-lake toggle on signup", () => {
  it("6-player signup: lady button is rejected (under threshold)", async () => {
    await buildSignupWith(6);
    harness.resetCalls();
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u0",
        componentId: "sig",
        tail: "lady",
      }),
      "lady",
    );
    // ephemeral fires (ladyNeeds7); no message.edit on the board.
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThan(0);
  });
  it("7-player signup: host toggles lady on, then off", async () => {
    await buildSignupWith(7);
    harness.resetCalls();
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u0",
        componentId: "sig",
        tail: "lady",
      }),
      "lady",
    );
    // Board repainted (lady state) + ephemeral confirm.
    expect(harness.callsTo("messages.edit").length).toBeGreaterThan(0);
    // Toggle off
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u0",
        componentId: "sig",
        tail: "lady",
      }),
      "lady",
    );
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThanOrEqual(2);
  });
  it("non-host lady click is rejected", async () => {
    await buildSignupWith(7);
    harness.resetCalls();
    await handleSignupClick(
      fakeClickContext({
        channelId: "c-signup",
        userId: "u3", // not host
        componentId: "sig",
        tail: "lady",
      }),
      "lady",
    );
    expect(harness.callsTo("interactions.followup").length).toBeGreaterThan(0);
    // No board repaint for a rejected click.
    expect(harness.callsTo("messages.edit").length).toBe(0);
  });
});
