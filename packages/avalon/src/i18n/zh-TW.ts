/**
 * Default locale (zh-TW). Mirrors the original Python bot's wording
 * verbatim where it makes sense; everything else is new wording for
 * the button-only redesign.
 *
 * Keys are flat dotted paths so a future i18n stack can pick this up
 * without restructuring. Don't nest beyond two levels.
 */
export const zhTW = {
  "plugin.description":
    "阿瓦隆桌遊機器人 — 透過共用按鈕進行遊戲，私密資訊以暫存訊息顯示，無需 DM。",
  "command.avalon.description": "阿瓦隆桌遊機器人",
  "command.avalon.start.description": "在此頻道開始一場新對局",
  "command.avalon.stop.description": "強制終止此頻道進行中的對局",

  "stage.signup.title": "開始新遊戲",
  "stage.signup.content":
    "按 **加入** 報名遊戲。\n參加者到齊後，由發起人 {host} 按下 **開始**。\n至少需 4 人才能開始。",
  "stage.signup.join": "加入",
  "stage.signup.leave": "離開",
  "stage.signup.start": "開始",
  "stage.signup.cancel": "取消",
  "stage.signup.fieldCount": "目前人數",
  "stage.signup.fieldRoster": "參加名單",
  "stage.signup.alreadyJoined": "你已經在名單中了。",
  "stage.signup.joined": "已加入。",
  "stage.signup.notInList": "你不在名單中。",
  "stage.signup.left": "已離開。",
  "stage.signup.onlyHost": "只有發起人可以開始 / 取消。",
  "stage.signup.notEnough": "需要至少 4 人才能開始。",
  "stage.signup.tooMany": "最多 10 人。",
  "stage.signup.cancelled": "已取消這場對局。",

  "stage.options.title": "規則設定",
  "stage.options.lady": "啟用湖中女神？",
  "stage.options.yes": "啟用",
  "stage.options.no": "不啟用",

  "stage.deal.title": "身份分派",
  "stage.deal.content":
    "**身份已分發。** 每位玩家請點擊下方 **查看身份** 按鈕，私下查看你的角色與視野。",
  "stage.deal.reveal": "查看身份",
  "stage.deal.notInGame": "你不在這場對局裡。",
  "stage.deal.yourRole": "你的身份：**{role}**",
  "stage.deal.legend": "🔵 亞瑟陣營　🔴 莫德雷德陣營",
  "stage.deal.legendPercival": "🔵 亞瑟陣營　🔴 莫德雷德陣營　🟣 梅林或莫甘娜",
  "stage.deal.vision": "你的視野",

  "stage.board.fieldPlayers": "玩家",
  "stage.board.fieldRoundStatus": "任務狀態",
  "stage.board.fieldVoteStatus": "投票次數",

  "stage.appoint.title": "第 {round} 輪：派任務",
  "stage.appoint.content": "由 {leader} 指派 **{num}** 員參與此次任務。",
  "stage.appoint.confirm": "確認",
  "stage.appoint.fieldRoster": "任務名單",
  "stage.appoint.fieldSelected": "目前選擇",
  "stage.appoint.selectedNone": "（尚未選擇）",
  "stage.appoint.notLeader": "只有此輪隊長可以指派。",
  "stage.appoint.full": "已選滿了。",
  "stage.appoint.toggled": "已切換選擇：{name}",
  "stage.appoint.needExact": "需要選滿 {num} 員。",

  "stage.publicVote.title": "第 {round} 輪：是否同意此次派遣？",
  "stage.publicVote.content": "由 {leader} 指派以下 **{num}** 員出任務，請全員投票。",
  "stage.publicVote.approve": "同意",
  "stage.publicVote.reject": "反對",
  "stage.publicVote.fieldRoster": "任務名單",
  "stage.publicVote.fieldVotes": "投票狀況",
  "stage.publicVote.fieldRejections": "連續否決",
  "stage.publicVote.voted": "{n} / {total} 已投",
  "stage.publicVote.fieldResult": "投票結果",
  "stage.publicVote.passed": "通過",
  "stage.publicVote.rejected": "否決",
  "stage.publicVote.tally": "✅ {yes}　❎ {no}",
  "stage.publicVote.notPlayer": "你不是這場對局的玩家。",
  "stage.publicVote.alreadyVoted": "你已經投過了。",
  "stage.publicVote.recorded": "已記錄你的投票：{vote}",
  "stage.publicVote.rejectionWarn": "連續否決 {n} / 5 — 達到 5 次紅方獲勝。",

  "stage.privateVote.title": "第 {round} 輪：任務投票",
  "stage.privateVote.content":
    "由 {leader} 指派的 **{num}** 員玩家正在執行任務 …",
  "stage.privateVote.openVote": "前往投票",
  "stage.privateVote.ephemeralPrompt": "請投出你的票",
  "stage.privateVote.success": "✅ 成功",
  "stage.privateVote.fail": "❎ 失敗",
  "stage.privateVote.need2Fail": "本輪 7 人以上需要兩張失敗票才會失敗。",
  "stage.privateVote.notMember": "你不在這次任務名單中。",
  "stage.privateVote.alreadyVoted": "你已經投過了。",
  "stage.privateVote.recordedSuccess": "你投了 ✅ 成功。",
  "stage.privateVote.recordedFail": "你投了 ❎ 失敗。",
  "stage.privateVote.evilOnly": "只有紅方可以投失敗。",
  "stage.privateVote.fieldVotes": "投票狀況",
  "stage.privateVote.fieldRoster": "任務名單",
  "stage.privateVote.voted": "{n} / {total} 已投",
  "stage.privateVote.resultSuccess": "第 {round} 輪任務成功",
  "stage.privateVote.resultFail": "第 {round} 輪任務失敗",
  "stage.privateVote.failCount": "本次任務有 {n} 張失敗票",
  "stage.privateVote.noFails": "本次任務沒有失敗票",

  "stage.lake.title": "湖中女神出現",
  "stage.lake.content":
    "由 {holder} 使用第 {n} 次湖中女神，請選擇要查驗的對象。",
  "stage.lake.checked": "{holder} 用湖中女神查驗了 {target}。",
  "stage.lake.notHolder": "只有持有湖中女神的玩家可以使用。",
  "stage.lake.cannotSelf": "不能對自己使用。",
  "stage.lake.cannotRepeat": "這位玩家已經被查驗過了。",
  "stage.lake.result": "{target} 的陣營：**{faction}**",
  "stage.lake.fieldHolder": "目前持有",

  "stage.assassinate.title": "刺殺階段",
  "stage.assassinate.content":
    "由刺客 {assassin} 選擇刺殺對象，若擊中梅林，紅方反敗為勝。",
  "stage.assassinate.notAssassin": "只有刺客可以執行刺殺。",
  "stage.assassinate.cannotSelf": "不能刺殺自己。",
  "stage.assassinate.result":
    "刺客 {assassin} 刺殺了 {target}\n{target} 的身份：**{role}**",

  "stage.ending.titleArthur": "亞瑟陣營勝利",
  "stage.ending.titleMordred": "莫德雷德陣營勝利",
  "stage.ending.reasonMissions":
    "三次任務成功 — 但接下來還有刺殺階段 …",
  "stage.ending.reasonMissionsClean": "三次任務成功，梅林安全。",
  "stage.ending.reasonMerlinKilled": "刺客成功刺殺了梅林。",
  "stage.ending.reasonMerlinSurvived": "刺客刺殺失敗。",
  "stage.ending.reasonFailures": "三次任務失敗。",
  "stage.ending.reasonRejections": "公開投票連續五次被否決，紅方獲勝。",
  "stage.ending.fieldRoster": "全員身份",

  "error.notInGuild": "此指令只能在伺服器中使用。",
  "error.alreadyRunning": "此頻道已有對局正在進行。",
  "error.notRunning": "此頻道沒有正在進行的對局。",
  "error.notHostCannotStop":
    "只有發起人或管理員可以強制終止對局。",
  "error.stopped": "已強制終止對局。",
  "error.timeout": "過長時間無人回應，對局已關閉。",

  "role.merlin": "梅林",
  "role.percival": "派西維爾",
  "role.assassin": "刺客",
  "role.morgana": "莫甘娜",
  "role.mordred": "莫德雷德",
  "role.oberon": "奧伯倫",
  "role.loyal": "亞瑟的忠臣",
  "role.minion": "莫德雷德的爪牙",
  "faction.arthur": "亞瑟陣營",
  "faction.mordred": "莫德雷德陣營",
} as const;

export type LocaleKey = keyof typeof zhTW;
