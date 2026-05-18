#!/usr/bin/env tsx
/**
 * Avalon scenario simulator.
 *
 * Each `scenarios/*.json` file is a fully-scripted game. The runner:
 *  1. Installs a fake Discord runtime (captures bot RPC calls).
 *  2. Builds a fresh GameState matching the scenario's seat layout.
 *  3. Walks the action script — either opening a stage (so subsequent
 *     clicks have something to land on) or firing a click through the
 *     real dispatcher.
 *  4. Asserts on the final state (winner, reason, stage, removal-from-store,
 *     specific verifier-style invariants).
 *
 * `pnpm --filter @karyl-chan/plugin-avalon simulate` runs every scenario;
 * exit code is 1 if ANY scenario fails. The unit/integration tests must
 * also be green (the simulator is the "full-game" tier; it leans on the
 * same dispatcher the unit tests cover).
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { wireRuntime, type BotRpc } from "../src/flow/runtime.js";
import { onComponent } from "../src/flow/dispatcher.js";
import { setGame, getGame, listGames, removeGame } from "../src/game/store.js";
import {
  listSignups,
  removeSignup,
} from "../src/flow/signup.js";
import {
  newGameState,
  type GameState,
  type Player,
} from "../src/game/state.js";
import { openAppoint } from "../src/flow/stages-appoint.js";
import { openPublicVote } from "../src/flow/stages-publicvote.js";
import { openPrivateVote } from "../src/flow/stages-privatevote.js";
import { openLake } from "../src/flow/stages-lake.js";
import { openAssassinate } from "../src/flow/stages-assassinate.js";
import { buildVision } from "../src/game/vision.js";
import type { ComponentContext } from "@karyl-chan/plugin-sdk";
import type { Position } from "../src/game/roles.js";

interface ScenarioAction {
  open?: "appoint" | "publicVote" | "privateVote" | "lake" | "assassinate";
  openArgs?: { missionMembers?: number[] };
  click?: {
    userId: string;
    componentId: string;
    tail?: string;
  };
  /** Direct state mutations — pre-record mission results to fast-forward */
  set?: {
    missionResults?: ("success" | "fail" | null)[];
    round?: number;
    consecutiveRejections?: number;
    leaderIndex?: number;
    ladyHolderIndex?: number;
  };
}

interface ExpectVisionRow {
  viewerUserId: string;
  targetUserId: string;
  marker: "self" | "red" | "blue" | "purple" | "unknown";
}

interface Scenario {
  name: string;
  positions: Position[];
  ladyEnabled?: boolean;
  channelId?: string;
  leaderIndex?: number;
  round?: number;
  ladyHolderIndex?: number;
  actions: ScenarioAction[];
  expect: {
    finalWinner?: "arthur" | "mordred";
    finalReason?: string;
    finalStage?: "lobby" | "playing" | "assassinate" | "ended";
    gameRemoved?: boolean;
    currentKind?: string | null;
    missionResults?: ("success" | "fail" | null)[];
    consecutiveRejections?: number;
    ladyHolderIndex?: number | null;
    ladyUseCount?: number;
    /** Per-viewer/target vision check after the script runs. */
    vision?: ExpectVisionRow[];
  };
}

// ── fake runtime ─────────────────────────────────────────────────────────

let messageCounter = 0;
const rpcLog: { path: string; body: unknown }[] = [];

function installRuntime(): void {
  messageCounter = 0;
  rpcLog.length = 0;
  const botRpc: BotRpc = async (path, body) => {
    rpcLog.push({ path, body });
    if (path === "/api/plugin/messages.send") {
      messageCounter++;
      const ch =
        (body as { channel_id?: string } | undefined)?.channel_id ?? "x";
      return { id: `m-${messageCounter}`, channel_id: ch };
    }
    return { ok: true };
  };
  wireRuntime({
    botRpc,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    publicBaseUrl: () => "http://test.local",
  });
}

function resetWorld(): void {
  for (const g of listGames()) removeGame(g.channelId);
  for (const s of listSignups()) removeSignup(s.channelId);
}

// ── scenario runner ──────────────────────────────────────────────────────

function buildGame(s: Scenario): GameState {
  const channelId = s.channelId ?? `scenario:${s.name}`;
  const game = newGameState({
    guildId: "g",
    channelId,
    hostUserId: "u0",
    signups: s.positions.map((_p, i) => ({
      userId: `u${i}`,
      displayName: `P${i}`,
    })),
    ladyEnabled: s.ladyEnabled ?? false,
  });
  game.players = s.positions.map(
    (position, i): Player => ({
      userId: `u${i}`,
      displayName: `P${i}`,
      index: i,
      position,
      lakeTarget: null,
    }),
  );
  game.stage = "playing";
  game.leaderIndex = s.leaderIndex ?? 0;
  game.round = s.round ?? 1;
  if (s.ladyHolderIndex !== undefined) game.ladyHolderIndex = s.ladyHolderIndex;
  setGame(channelId, game);
  return game;
}

function fakeContext(args: {
  channelId: string;
  userId: string;
  componentId: string;
  tail: string;
}): ComponentContext {
  return {
    pluginKey: "karyl-avalon",
    customId: `kc:karyl-avalon:${args.componentId}${
      args.tail ? `:${args.tail}` : ""
    }`,
    componentId: args.componentId,
    tail: args.tail,
    guildId: "g",
    channelId: args.channelId,
    messageId: "msg-fake",
    interactionToken: `tok-${args.userId}-${Math.random()}`,
    userId: args.userId,
    userDisplayName: args.userId,
    voiceChannelId: null,
    capabilities: [],
    hasCapability: () => false,
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    publicBaseUrl: "http://test.local",
    botRpc: async () => null,
  };
}

async function runScenario(s: Scenario): Promise<void> {
  installRuntime();
  resetWorld();
  const game = buildGame(s);
  const channelId = game.channelId;

  for (const [i, action] of s.actions.entries()) {
    const live = getGame(channelId);
    if (!live && !s.expect.gameRemoved) {
      throw new Error(
        `step ${i}: game vanished mid-script (removed too early). scenario=${s.name}`,
      );
    }
    if (action.set) {
      const live2 = getGame(channelId);
      if (!live2) {
        throw new Error(
          `step ${i}: set on a missing game. scenario=${s.name}`,
        );
      }
      const set = action.set;
      if (set.missionResults) live2.missionResults = [...set.missionResults];
      if (set.round !== undefined) live2.round = set.round;
      if (set.consecutiveRejections !== undefined) {
        live2.consecutiveRejections = set.consecutiveRejections;
      }
      if (set.leaderIndex !== undefined) live2.leaderIndex = set.leaderIndex;
      if (set.ladyHolderIndex !== undefined) {
        live2.ladyHolderIndex = set.ladyHolderIndex;
      }
      continue;
    }
    if (action.open) {
      const live2 = getGame(channelId);
      if (!live2) throw new Error(`step ${i}: open on missing game`);
      switch (action.open) {
        case "appoint":
          await openAppoint(live2);
          break;
        case "publicVote":
          if (!action.openArgs?.missionMembers) {
            throw new Error(`step ${i}: publicVote requires missionMembers`);
          }
          await openPublicVote(live2, action.openArgs.missionMembers);
          break;
        case "privateVote":
          if (!action.openArgs?.missionMembers) {
            throw new Error(`step ${i}: privateVote requires missionMembers`);
          }
          await openPrivateVote(live2, action.openArgs.missionMembers);
          break;
        case "lake":
          await openLake(live2);
          break;
        case "assassinate":
          await openAssassinate(live2);
          break;
      }
      continue;
    }
    if (action.click) {
      const ctx = fakeContext({
        channelId,
        userId: action.click.userId,
        componentId: action.click.componentId,
        tail: action.click.tail ?? "",
      });
      await onComponent(ctx, action.click.componentId);
      continue;
    }
    throw new Error(`step ${i}: empty action — expected open/click/set`);
  }

  // ── assertions ────────────────────────────────────────────────────────
  const exp = s.expect;
  const post = getGame(channelId);
  if (exp.gameRemoved) {
    if (post !== null) {
      throw new Error(
        `expected game to be removed; still present in stage=${post.stage}`,
      );
    }
  } else if (post === null) {
    throw new Error(`game unexpectedly removed`);
  }
  if (exp.finalStage !== undefined) {
    if (!post) throw new Error(`finalStage check requires live game`);
    assertEq("finalStage", post.stage, exp.finalStage);
  }
  if (exp.currentKind !== undefined) {
    if (!post) throw new Error(`currentKind check requires live game`);
    assertEq(
      "currentKind",
      post.current?.kind ?? null,
      exp.currentKind,
    );
  }
  if (exp.finalWinner !== undefined) {
    // Winner / reason isn't preserved after endGame removes the channel,
    // so we infer from the RPC log: the ending board send carries the
    // title key.
    const endingMsg = rpcLog
      .filter((r) => r.path === "/api/plugin/messages.send")
      .map(
        (r) => r.body as { embeds?: { title?: string }[] } | undefined,
      )
      .filter((b) => b?.embeds?.[0]?.title?.includes("勝利"))
      .pop();
    if (!endingMsg) throw new Error(`no ending embed observed`);
    const title = endingMsg.embeds![0].title ?? "";
    const winner = title.includes("亞瑟") ? "arthur" : "mordred";
    assertEq("finalWinner", winner, exp.finalWinner);
  }
  if (exp.missionResults !== undefined) {
    if (!post) throw new Error(`missionResults check requires live game`);
    assertDeep("missionResults", post.missionResults, exp.missionResults);
  }
  if (exp.consecutiveRejections !== undefined) {
    if (!post) throw new Error(`rejections check requires live game`);
    assertEq("rejections", post.consecutiveRejections, exp.consecutiveRejections);
  }
  if (exp.ladyHolderIndex !== undefined) {
    if (!post) throw new Error(`ladyHolderIndex check requires live game`);
    assertEq("ladyHolderIndex", post.ladyHolderIndex, exp.ladyHolderIndex);
  }
  if (exp.ladyUseCount !== undefined) {
    if (!post) throw new Error(`ladyUseCount check requires live game`);
    assertEq("ladyUseCount", post.ladyUseCount, exp.ladyUseCount);
  }
  if (exp.vision && post) {
    for (const v of exp.vision) {
      const viewer = post.players.find((p) => p.userId === v.viewerUserId);
      const target = post.players.find((p) => p.userId === v.targetUserId);
      if (!viewer || !target) {
        throw new Error(
          `vision check refers to unknown user(s): ${v.viewerUserId} / ${v.targetUserId}`,
        );
      }
      const row = buildVision(post, viewer).find(
        (r) => r.player.userId === target.userId,
      );
      if (!row) throw new Error(`vision row missing`);
      assertEq(
        `vision[${v.viewerUserId}→${v.targetUserId}]`,
        row.marker,
        v.marker,
      );
    }
  }
}

function assertEq<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeep(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const scenariosDir = resolve(here, "scenarios");
  const files = readdirSync(scenariosDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  if (files.length === 0) {
    console.error("no scenarios found at " + scenariosDir);
    process.exit(2);
  }
  let pass = 0;
  let fail = 0;
  const failures: { name: string; err: string }[] = [];
  for (const file of files) {
    const raw = readFileSync(join(scenariosDir, file), "utf-8");
    let scenario: Scenario;
    try {
      scenario = JSON.parse(raw) as Scenario;
    } catch (err) {
      console.error(`✗ ${file}: failed to parse: ${(err as Error).message}`);
      fail++;
      continue;
    }
    process.stdout.write(`  ${file} … `);
    try {
      await runScenario(scenario);
      console.log("ok");
      pass++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAIL — ${msg}`);
      failures.push({ name: file, err: msg });
      fail++;
    }
  }
  console.log("");
  console.log(`scenarios: ${pass} passed, ${fail} failed (total ${files.length})`);
  if (fail > 0) {
    console.log("");
    console.log("failures:");
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.err}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
