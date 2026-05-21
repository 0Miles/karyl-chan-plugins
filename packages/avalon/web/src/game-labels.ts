// zh-TW display strings for the game board. The backend has its own
// server-side i18n (src/i18n) for Discord embeds; the WebUI needs its
// own browser-side copy for the snapshot enums it renders.

import type {
  Faction,
  GameEvent,
  RolePosition,
  VisionMarker,
} from "./game-types";

export const ROLE_NAME: Record<RolePosition, string> = {
  merlin: "梅林",
  percival: "派西維爾",
  assassin: "刺客",
  morgana: "莫甘娜",
  mordred: "莫德雷",
  oberon: "奧伯倫",
  loyal: "亞瑟的忠臣",
  minion: "莫德雷的爪牙",
};

export const ROLE_ABILITY: Record<RolePosition, string> = {
  merlin: "你能看見大部分壞人（莫德雷除外）。別讓刺客找出你。",
  percival: "你能看見梅林與莫甘娜，但分不出誰是誰。",
  loyal: "你沒有特殊視野，協助好人完成三場任務。",
  assassin: "好人達標時你能刺殺一人；猜中梅林即逆轉勝。",
  morgana: "你在派西維爾眼中與梅林無異，用來混淆他。",
  mordred: "梅林看不見你——你是壞人陣營的隱藏王牌。",
  oberon: "你與其他壞人互相看不見，獨自行動。",
  minion: "莫德雷的爪牙，設法讓任務失敗。",
};

export const FACTION_NAME: Record<Faction, string> = {
  arthur: "亞瑟王陣營",
  mordred: "莫德雷陣營",
};

export const MARKER_LABEL: Record<VisionMarker, string> = {
  self: "你自己",
  red: "壞人",
  blue: "好人",
  purple: "梅林或莫甘娜",
  unknown: "未知",
};

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
  "missions-clean": "好人連續完成三場任務",
  "missions-then-assassinate": "三場任務成功，進入刺殺",
  "missions-failed": "任務失敗三次",
  rejections: "隊伍連續被否決五次",
  "merlin-killed": "刺客成功刺殺梅林",
  "merlin-survived": "梅林在刺殺中存活",
};

/**
 * One-line zh-TW description of a timeline event. `seatName` maps a
 * 0-based seat index to a display name.
 */
export function describeEvent(
  ev: GameEvent,
  seatName: (seat: number) => string,
): { icon: string; text: string } {
  switch (ev.kind) {
    case "team-proposed":
      return {
        icon: "📋",
        text: `第 ${ev.round} 回合 · ${seatName(ev.leaderSeat)} 提名隊伍：${ev.memberSeats
          .map(seatName)
          .join("、")}`,
      };
    case "public-vote":
      return {
        icon: ev.approved ? "✅" : "🚫",
        text: `隊伍投票${ev.approved ? "通過" : "遭否決"}（贊成 ${ev.yes} · 反對 ${ev.no}）`,
      };
    case "mission-result":
      return {
        icon: ev.result === "success" ? "🟦" : "🟥",
        text:
          `第 ${ev.round} 回合任務${ev.result === "success" ? "成功" : "失敗"}` +
          (ev.failCount > 0 ? ` · ${ev.failCount} 張失敗票` : ""),
      };
    case "lake-used":
      return {
        icon: "🔮",
        text: `${seatName(ev.holderSeat)} 用湖中女神查驗了 ${seatName(ev.targetSeat)}`,
      };
    case "assassinate":
      return {
        icon: "🗡",
        text: `${seatName(ev.assassinSeat)} 刺殺了 ${seatName(ev.targetSeat)}（${ROLE_NAME[ev.targetRole]}）`,
      };
    case "game-end":
      return {
        icon: ev.winner === "arthur" ? "🏆" : "💀",
        text: `遊戲結束 · ${FACTION_NAME[ev.winner]}勝利`,
      };
  }
}
