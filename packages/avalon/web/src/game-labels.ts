// zh-TW display strings for the game board. The backend has its own
// server-side i18n (src/i18n) for Discord embeds; the WebUI needs its
// own browser-side copy for the snapshot enums it renders.

import type {
  Faction,
  GameEvent,
  PlayerView,
  RolePosition,
  VisionMarker,
} from "./game-types";

// Role names, faction names and ability lines are kept in step with
// the bot's Discord-side i18n (src/i18n/zh-TW.ts) — same terminology
// so a player sees one consistent vocabulary across Discord and the
// WebUI. The ability lines mirror the `role.flavor.*` keys.

export const ROLE_NAME: Record<RolePosition, string> = {
  merlin: "梅林",
  percival: "派西維爾",
  assassin: "刺客",
  morgana: "莫甘娜",
  mordred: "莫德雷德",
  oberon: "奧伯倫",
  loyal: "亞瑟的忠臣",
  minion: "莫德雷德的爪牙",
};

export const ROLE_ABILITY: Record<RolePosition, string> = {
  merlin:
    "你看得見莫甘娜、刺客、奧伯倫（莫德雷德除外）。別讓刺客找出你。",
  percival: "你看見梅林與莫甘娜，但分不清誰是誰。保護真正的梅林。",
  loyal: "你看不見任何身份。觀察行為，跟隨梅林的暗示。",
  assassin: "三次任務成功後，你有一次機會擊殺梅林、反敗為勝。",
  morgana: "派西維爾會把你誤認成梅林。儘量假裝藍方。",
  mordred: "連梅林也看不見你，潛伏吧。",
  oberon: "你看不見隊友、隊友也看不見你。獨自破壞任務。",
  minion: "你看得見除奧伯倫外的紅方夥伴，與其他紅角合作破壞任務。",
};

export const FACTION_NAME: Record<Faction, string> = {
  arthur: "亞瑟陣營",
  mordred: "莫德雷德陣營",
};

export const MARKER_LABEL: Record<VisionMarker, string> = {
  self: "你自己",
  red: "紅方",
  blue: "藍方",
  purple: "梅林或莫甘娜",
  unknown: "未知",
};

/** CSS colour per vision marker — the board's faction palette. */
export const MARKER_COLOR: Record<VisionMarker, string> = {
  self: "var(--accent)",
  red: "var(--faction-mordred)",
  blue: "var(--faction-arthur)",
  purple: "#8b5cf6",
  unknown: "var(--text-faint)",
};

/**
 * Colour for a player's vision marker. Shared by the player list and
 * the history items so a seat's faction reads consistently across
 * the board.
 */
export function markerColor(player: PlayerView): string {
  return MARKER_COLOR[player.marker];
}

export const STAGE_LABEL: Record<string, string> = {
  lobby: "準備中",
  playing: "進行中",
  assassinate: "刺殺階段",
  ended: "已結束",
};

export const CURRENT_STAGE_LABEL: Record<string, string> = {
  appoint: "隊長提名隊伍中",
  publicVote: "隊伍投票中",
  privateVote: "任務進行中",
  lake: "湖中女神查驗中",
  assassinate: "刺客抉擇中",
};

export const END_REASON_LABEL: Record<string, string> = {
  "missions-clean": "藍方連續完成三場任務",
  "missions-then-assassinate": "三場任務成功，進入刺殺",
  "missions-failed": "任務失敗三次",
  rejections: "隊伍連續被否決五次",
  "merlin-killed": "刺客成功刺殺梅林",
  "merlin-survived": "梅林在刺殺中存活",
};

/** A per-event marker shown on a history player item. */
export type HistoryTagKind =
  | "yes"
  | "no"
  | "holder"
  | "target"
  | "assassin";

export interface HistoryTag {
  label: string;
  kind: HistoryTagKind;
}

/** A player mentioned by a history event, with that event's markers. */
export interface HistoryPlayerRef {
  seat: number;
  tags: HistoryTag[];
}

/**
 * A labelled set of players within an event card. Most events have a
 * single unlabelled group; team-proposed splits the leader and the
 * proposed team into two labelled groups.
 */
export interface HistoryGroup {
  label?: string;
  players: HistoryPlayerRef[];
}

/** One history event rendered as an independent card. */
export interface EventCard {
  icon: string;
  title: string;
  /** Optional secondary line (tally, target role, …). */
  note?: string;
  /** Player groups the event involves — rendered as avatar + name items. */
  groups: HistoryGroup[];
}

/**
 * Describe a timeline event as a card: a title, an optional note, and
 * the player groups it involves. The component resolves each `seat`
 * to an avatar + display name.
 */
export function describeEvent(ev: GameEvent): EventCard {
  switch (ev.kind) {
    case "team-proposed":
      return {
        icon: "📋",
        title: `第 ${ev.round} 回合 · 隊長提名隊伍`,
        // Leader and proposed team shown as two separate groups.
        groups: [
          { label: "隊長", players: [{ seat: ev.leaderSeat, tags: [] }] },
          {
            label: "提名隊伍",
            players: ev.memberSeats.map((seat) => ({ seat, tags: [] })),
          },
        ],
      };
    case "public-vote":
      return {
        icon: ev.approved ? "✅" : "🚫",
        title: `第 ${ev.round} 回合 · 隊伍投票${ev.approved ? "通過" : "遭否決"}`,
        note: `贊成 ${ev.yes} · 反對 ${ev.no}`,
        groups: [
          {
            players: ev.ballots.map((b) => ({
              seat: b.seat,
              tags: [
                b.vote === "yes"
                  ? { label: "同意", kind: "yes" }
                  : { label: "反對", kind: "no" },
              ],
            })),
          },
        ],
      };
    case "mission-result":
      return {
        icon: ev.result === "success" ? "🟦" : "🟥",
        title: `第 ${ev.round} 回合 · 任務${ev.result === "success" ? "成功" : "失敗"}`,
        note: ev.failCount > 0 ? `${ev.failCount} 張失敗票` : "無失敗票",
        groups: [],
      };
    case "lake-used":
      return {
        icon: "🔮",
        title: "湖中女神查驗",
        groups: [
          {
            players: [
              { seat: ev.holderSeat, tags: [{ label: "查驗者", kind: "holder" }] },
              { seat: ev.targetSeat, tags: [{ label: "被查驗", kind: "target" }] },
            ],
          },
        ],
      };
    case "assassinate":
      return {
        icon: "🗡",
        title: "刺客刺殺",
        note: `目標真實身分:${ROLE_NAME[ev.targetRole]}`,
        groups: [
          {
            players: [
              {
                seat: ev.assassinSeat,
                tags: [{ label: "刺客", kind: "assassin" }],
              },
              { seat: ev.targetSeat, tags: [{ label: "被刺殺", kind: "target" }] },
            ],
          },
        ],
      };
    case "game-end":
      return {
        icon: ev.winner === "arthur" ? "🏆" : "💀",
        title: `遊戲結束 · ${FACTION_NAME[ev.winner]}勝利`,
        groups: [],
      };
  }
}
