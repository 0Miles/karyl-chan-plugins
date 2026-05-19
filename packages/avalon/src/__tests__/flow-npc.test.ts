import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGame,
  click,
  installFakeRuntime,
  resetWorldState,
  getGame,
  type InstalledHarness,
} from "./_harness.js";
import { NPC_USERID_PREFIX } from "../game/state.js";
import { openAppoint } from "../flow/stages-appoint.js";
import {
  resetNpcDelayMs,
  resetNpcRng,
  setNpcDelayMs,
  setNpcRng,
} from "../npc/driver.js";

let harness: InstalledHarness;

/**
 * Drain the microtask queue (queueMicrotask scheduling in the NPC
 * driver) AND yield to the event loop so libuv I/O callbacks fire —
 * needed because `endGame` does a real `readdir` via the art store
 * when computing the MVP card image, and microtask-only draining
 * leaves that pending.
 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
  // Yield to the I/O phase so any pending fs callbacks resolve.
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

/** Mulberry32 seeded RNG — deterministic across test runs. */
function seededRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  resetWorldState();
  harness = installFakeRuntime();
  setNpcDelayMs({ min: 0, max: 0 });
  setNpcRng(seededRng(42));
});
afterEach(() => {
  resetWorldState();
  resetNpcDelayMs();
  resetNpcRng();
});

describe("flow-npc-001: appoint stage auto-resolves when NPC is leader", () => {
  it("NPC leader picks a mission roster and the stage advances to publicVote", async () => {
    // 5p table where seat 0 is an NPC leader. Mission size for round 1 = 2.
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-npc-leader",
      leaderIndex: 0,
    });
    // Repaint seat 0 to be an NPC.
    game.players[0].userId = `${NPC_USERID_PREFIX}0`;
    game.players[0].displayName = "NPC-Lead";

    await openAppoint(game);
    await drainMicrotasks();

    // The NPC should have committed a roster + transitioned to publicVote.
    const current = getGame("c-npc-leader")?.current;
    expect(current?.kind).toBe("publicVote");
    if (current?.kind !== "publicVote") throw new Error("expected publicVote");
    expect(current.missionMembers).toHaveLength(2);
  });
});

describe("flow-npc-002: public vote stage auto-fills NPC ballots", () => {
  it("NPC voters record yes/no votes; humans complete the tally", async () => {
    // Mix of 2 humans (u3, u4) + 3 NPCs (npc:0..2). Human u3 is leader.
    const game = buildGame({
      positions: ["loyal", "assassin", "morgana", "merlin", "loyal"],
      channelId: "c-npc-public",
      leaderIndex: 3, // human leader
    });
    for (const i of [0, 1, 2]) {
      game.players[i].userId = `${NPC_USERID_PREFIX}${i}`;
      game.players[i].displayName = `NPC-${i}`;
    }

    await openAppoint(game);
    // Leader (u3) picks seats 3 + 4 and confirms.
    await click({ channelId: "c-npc-public", userId: "u3", componentId: "appt", tail: "s:3" });
    await click({ channelId: "c-npc-public", userId: "u3", componentId: "appt", tail: "s:4" });
    await click({ channelId: "c-npc-public", userId: "u3", componentId: "appt", tail: "c" });
    await drainMicrotasks();

    // publicVote opened. NPCs auto-voted. Humans still need to vote.
    const current = getGame("c-npc-public")?.current;
    expect(current?.kind).toBe("publicVote");
    if (current?.kind !== "publicVote") throw new Error("expected publicVote");
    expect(Object.keys(current.votes).sort()).toEqual([
      "npc:0",
      "npc:1",
      "npc:2",
    ]);
    // Humans vote — completes the tally and the stage advances.
    await click({ channelId: "c-npc-public", userId: "u3", componentId: "pub", tail: "y" });
    await click({ channelId: "c-npc-public", userId: "u4", componentId: "pub", tail: "y" });
    await drainMicrotasks();
    expect(getGame("c-npc-public")?.current?.kind).not.toBe("publicVote");
  });
});

describe("flow-npc-003: private vote — Arthur NPCs vote success, Mordred NPCs vote fail", () => {
  it("mission outcome reflects faction-correct ballots", async () => {
    // 5p with NPC roster that puts an evil and a good on the mission.
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-npc-priv",
      leaderIndex: 3,
      round: 2, // mission size 3 on r2
    });
    for (const i of [0, 1, 2]) {
      game.players[i].userId = `${NPC_USERID_PREFIX}${i}`;
      game.players[i].displayName = `NPC-${i}`;
    }
    // Drive: human leader picks seats 1 (assassin NPC), 3 (loyal human), 4 (loyal human).
    await openAppoint(game);
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "appt", tail: "s:1" });
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "appt", tail: "s:3" });
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "appt", tail: "s:4" });
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "appt", tail: "c" });
    await drainMicrotasks();
    // Every player approves so privateVote opens.
    for (const u of ["u3", "u4"]) {
      await click({ channelId: "c-npc-priv", userId: u, componentId: "pub", tail: "y" });
    }
    await drainMicrotasks();
    // Now in privateVote with NPC assassin on the team — they should
    // have already voted fail (seed 42 lands inside the 80% threshold).
    const cur = getGame("c-npc-priv")?.current;
    expect(cur?.kind).toBe("privateVote");
    if (cur?.kind !== "privateVote") throw new Error("expected privateVote");
    expect(cur.votes["npc:1"]).toBe("fail");

    // Humans vote success — mission resolves as fail.
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "priv", tail: "open" });
    await click({ channelId: "c-npc-priv", userId: "u3", componentId: "priv", tail: "s" });
    await click({ channelId: "c-npc-priv", userId: "u4", componentId: "priv", tail: "open" });
    await click({ channelId: "c-npc-priv", userId: "u4", componentId: "priv", tail: "s" });
    await drainMicrotasks();
    const after = getGame("c-npc-priv");
    expect(after?.missionResults[1]).toBe("fail");
  });
});

describe("flow-npc-004: NPC-only game runs to a verdict", () => {
  it("five NPCs auto-resolve missions, assassinate, and the game ends", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-npc-solo",
      leaderIndex: 0,
    });
    for (let i = 0; i < 5; i++) {
      game.players[i].userId = `${NPC_USERID_PREFIX}${i}`;
      game.players[i].displayName = `NPC-${i}`;
    }
    await openAppoint(game);
    // Drain enough microtasks to let the entire game self-play through
    // round-by-round transitions. Each open*() chains the next NPC tick
    // via queueMicrotask in delay=0 mode.
    for (let i = 0; i < 50; i++) {
      await drainMicrotasks();
    }
    // Game should have ended (game record removed by endGame). The
    // fake runtime should have logged the verdict embed.
    expect(getGame("c-npc-solo")).toBeNull();
    // Sanity: an ending embed was sent.
    const sends = harness.callsTo("messages.send");
    const lastEmbed = sends[sends.length - 1].body as {
      embeds?: Array<{ title?: string }>;
    };
    expect(lastEmbed.embeds?.[0]?.title).toMatch(/亞瑟陣營勝利|莫德雷德陣營勝利/);
  });
});

describe("flow-npc-005: /avalon stop cancels pending NPC timer", () => {
  it("clearNpcTimer prevents an in-flight schedule from firing on a removed game", async () => {
    const game = buildGame({
      positions: ["merlin", "assassin", "morgana", "loyal", "loyal"],
      channelId: "c-npc-stop",
      leaderIndex: 0,
    });
    game.players[0].userId = `${NPC_USERID_PREFIX}0`;
    // Force a real timer by re-enabling the delay window — the schedule
    // becomes asynchronous, then we tear it down before it fires.
    setNpcDelayMs({ min: 50, max: 50 });
    await openAppoint(game);
    // Synchronously remove the game and clear the timer like /avalon stop.
    const { clearNpcTimer } = await import("../npc/driver.js");
    clearNpcTimer("c-npc-stop");
    const { removeGame } = await import("../game/store.js");
    removeGame("c-npc-stop");
    // Wait past the original delay — if the timer had fired we'd see
    // an error log from the driver (state.sessionId mismatch / null
    // game). It bails silently.
    await new Promise((r) => setTimeout(r, 80));
    expect(harness.logsAt("error").length).toBe(0);
  });
});
