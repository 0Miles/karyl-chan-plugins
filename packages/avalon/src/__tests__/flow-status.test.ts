import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGame, installFakeRuntime, resetWorldState } from "./_harness.js";
import { openAppoint } from "../flow/stages-appoint.js";
import { openPublicVote } from "../flow/stages-publicvote.js";
import { openPrivateVote } from "../flow/stages-privatevote.js";
import { openLake } from "../flow/stages-lake.js";
import { openAssassinate } from "../flow/stages-assassinate.js";
import { renderCurrentStageBoard } from "../flow/stages.js";

const P5: Parameters<typeof buildGame>[0]["positions"] = [
  "merlin",
  "assassin",
  "morgana",
  "loyal",
  "loyal",
];

beforeEach(() => {
  resetWorldState();
  installFakeRuntime();
});
afterEach(() => resetWorldState());

describe("flow-status: renderCurrentStageBoard rebuilds the live stage board", () => {
  it("returns null when no stage is active", async () => {
    const game = buildGame({ positions: P5, channelId: "c-st-none" });
    // buildGame leaves state.current === null until a stage opens.
    expect(await renderCurrentStageBoard(game)).toBeNull();
  });

  it("appoint → embed + seat buttons", async () => {
    const game = buildGame({
      positions: P5,
      channelId: "c-st-appt",
      leaderIndex: 0,
    });
    await openAppoint(game);
    const board = await renderCurrentStageBoard(game);
    expect(board).not.toBeNull();
    expect(board!.embeds).toHaveLength(1);
    // 5 seat buttons + confirm row + view-card row.
    expect(board!.components.length).toBeGreaterThan(0);
  });

  it("appoint → board reflects already-selected seats", async () => {
    const game = buildGame({
      positions: P5,
      channelId: "c-st-appt2",
      leaderIndex: 0,
    });
    await openAppoint(game);
    if (game.current?.kind === "appoint") game.current.selected = [1, 2];
    const board = await renderCurrentStageBoard(game);
    // Seat buttons for 1 and 2 render in the "selected" (green) style 3.
    const seatBtns = board!.components
      .flatMap((r) => r.components)
      .filter((b) => b.custom_id.includes(":appt:s:"));
    const selected = seatBtns.filter((b) => b.style === 3);
    expect(selected).toHaveLength(2);
  });

  it("publicVote → embed + approve/reject buttons", async () => {
    const game = buildGame({
      positions: P5,
      channelId: "c-st-pub",
      leaderIndex: 0,
    });
    await openPublicVote(game, [0, 1]);
    const board = await renderCurrentStageBoard(game);
    expect(board).not.toBeNull();
    expect(board!.embeds).toHaveLength(1);
    expect(board!.components.length).toBeGreaterThan(0);
  });

  it("privateVote → embed + go-to-vote button", async () => {
    const game = buildGame({
      positions: P5,
      channelId: "c-st-priv",
      leaderIndex: 0,
    });
    await openPrivateVote(game, [0, 1]);
    const board = await renderCurrentStageBoard(game);
    expect(board).not.toBeNull();
    expect(board!.embeds).toHaveLength(1);
  });

  it("lake → embed + holder seat buttons", async () => {
    const game = buildGame({
      positions: [
        "merlin",
        "assassin",
        "percival",
        "morgana",
        "mordred",
        "loyal",
        "loyal",
      ],
      channelId: "c-st-lake",
      ladyEnabled: true,
      ladyHolderIndex: 5,
      round: 2,
    });
    await openLake(game);
    const board = await renderCurrentStageBoard(game);
    expect(board).not.toBeNull();
    expect(board!.embeds).toHaveLength(1);
    expect(board!.components.length).toBeGreaterThan(0);
  });

  it("assassinate → embed + non-assassin seat buttons", async () => {
    const game = buildGame({ positions: P5, channelId: "c-st-asn" });
    await openAssassinate(game);
    const board = await renderCurrentStageBoard(game);
    expect(board).not.toBeNull();
    expect(board!.embeds).toHaveLength(1);
    // One button per non-assassin seat (+ view-card row).
    const asnBtns = board!.components
      .flatMap((r) => r.components)
      .filter((b) => b.custom_id.includes(":asn:"));
    expect(asnBtns).toHaveLength(4);
  });
});
