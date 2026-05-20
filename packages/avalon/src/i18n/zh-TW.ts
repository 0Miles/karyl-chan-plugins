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
  "command.avalon.start.npcOption": "預先加入的 NPC 數量（0–9，可選；用來湊人數）",
  "command.avalon.start.morganaOption":
    "是否加入莫甘娜（預設開啟；關閉則由爪牙替代）",
  "command.avalon.start.percivalOption":
    "是否加入派西維爾（預設開啟；關閉則由忠臣替代）",
  "command.avalon.start.mordredOption":
    "是否加入莫德雷德（預設開啟；7 人以上適用；關閉則由爪牙替代）",
  "command.avalon.start.oberonOption":
    "是否加入奧伯倫（預設開啟；10 人適用；關閉則由爪牙替代）",
  "command.avalon.start.lakeOption":
    "是否啟用湖中女神（預設開啟；7 人以上才會生效）",
  "command.avalon.card.description": "再次查看你的角色卡與視野",
  "command.avalon.status.description":
    "重新取得當前階段的遊戲板（含按鈕），免去往上翻對話記錄",
  "command.avalon.status.publicOption":
    "改以公開訊息重發遊戲板（限主持人/管理員，預設關閉）",
  "status.refreshed": "已重新發佈當前階段的遊戲板。",
  "status.refreshFailed": "⚠ 重發遊戲板失敗，請稍後再試。",
  "status.publicOnlyHost": "只有發起人或管理員可以公開重發遊戲板。",
  "stage.board.viewCard": "🪪 查看角色卡",
  "command.avalon.stop.description": "強制終止此頻道進行中的對局",
  "command.avalon.manage.description": "取得阿瓦隆管理 WebUI 的一次性連結",
  "manage.title": "阿瓦隆管理面板",
  "manage.description":
    "查看進行中對局與報名，必要時可強制終止。15 分鐘內開啟連結；瀏覽頁籤之後會自動續約最多 1 天。",
  "manage.openButton": "開啟管理 WebUI",
  "manage.notAllowed":
    "你沒有阿瓦隆 WebUI 的存取權限。請管理員授予 `plugin:karyl-avalon:manage` 給你的角色。",
  "manage.botRejected":
    "Bot 拒絕了登入請求 — 可能 `auth.session` RPC scope 尚未核可。",

  "stage.signup.title": "開始新遊戲",
  "stage.signup.content":
    "按 **加入** 報名遊戲。\n參加者到齊後，由發起人 {host} 按下 **開始**。\n至少需 5 人才能開始。",
  "stage.signup.join": "加入",
  "stage.signup.leave": "離開",
  "stage.signup.start": "開始",
  "stage.signup.cancel": "取消",
  "stage.signup.fieldCount": "目前人數",
  "stage.signup.fieldRoster": "參加名單",
  "stage.signup.cancelled": "已取消這場對局。",
  "stage.signup.fieldRules": "規則設定",
  "stage.signup.fieldLady": "湖中女神",
  "stage.signup.lakeNote": "（7 人以上生效）",
  "stage.signup.fieldNpcRoster": "NPC 名單",
  "stage.signup.fieldNpcCount": "NPC 人數",
  "stage.signup.npcAdd": "+ NPC",
  "stage.signup.npcRemove": "− NPC",
  "stage.signup.npcLineSuffix": "（NPC）",

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
  "stage.deal.helpButton": "📖 查看角色說明",
  "stage.deal.helpTitle": "角色說明 — {role}",
  "stage.deal.markerSection": "你的視野標記說明",

  "marker.self": "你自己",
  "marker.merlinRed": "你看到的紅方角色",
  "marker.percivalPurple": "梅林或莫甘娜",
  "marker.evilRed": "你的紅方夥伴",
  "marker.unknown": "無法判斷陣營",

  "role.description.merlin":
    "你是 **梅林**，亞瑟陣營的智者。視野裡所有紅方會被標記為 🔴 — 但莫德雷德對你隱形（標記為 ⬜）。\n\n勝利條件：協助藍方完成 3 次任務 **且不被刺客找出**。三次任務成功後，刺客有一次機會擊殺梅林反敗為勝 — 所以暗示資訊時要克制，別讓刺客鎖定你。",
  "role.description.percival":
    "你是 **派西維爾**，亞瑟陣營的守護者。視野裡梅林與莫甘娜都被標記為 🟣，你**分不清誰是誰** — 一個是真梅林、一個是冒充的莫甘娜。\n\n勝利條件：協助藍方完成 3 次任務 + 保護真梅林不被刺殺。透過投票風格、推派人選、發言內容判斷誰是真梅林、誰是莫甘娜。",
  "role.description.loyal":
    "你是 **亞瑟的忠臣**。沒有特殊資訊 — 視野裡所有人都是 ⬜。\n\n勝利條件：協助藍方完成 3 次任務。透過觀察任務派人、投票模式、失敗票數來推測誰是內奸。",
  "role.description.assassin":
    "你是 **刺客**，莫德雷德陣營的核心。視野裡除了奧伯倫以外的紅方夥伴會被標記為 🔴。\n\n勝利條件：\n1) 讓任務失敗 3 次，或\n2) 三次任務成功後 **由你執行刺殺** — 從藍方玩家中挑出梅林擊殺，紅方反敗為勝。觀察行為找出梅林是你的關鍵任務。",
  "role.description.morgana":
    "你是 **莫甘娜**，莫德雷德陣營。視野裡除了奧伯倫以外的紅方夥伴會被標記為 🔴。\n\n**派西維爾會把你誤認為梅林** — 行為要像梅林（積極推派、暗示資訊），把派西維爾的判斷帶偏。\n\n勝利條件：讓任務失敗 3 次，或刺客成功擊殺梅林。",
  "role.description.mordred":
    "你是 **莫德雷德**，紅方領袖。視野裡除了奧伯倫以外的紅方夥伴會被標記為 🔴。\n\n**梅林看不見你** — 你是紅方在藍方視野中的隱形單位。可以放心積極推派、發言，藍方無法靠視野鎖定你。\n\n勝利條件：讓任務失敗 3 次，或刺客成功擊殺梅林。",
  "role.description.oberon":
    "你是 **奧伯倫**，紅方獨行者。視野裡所有人會被標記為 ⬜ — **你看不見紅方夥伴、紅方夥伴也看不見你**。\n\n獨自製造任務失敗，但不知道誰是你那邊的。\n\n勝利條件：讓任務失敗 3 次，或刺客成功擊殺梅林。",
  "role.description.minion":
    "你是 **莫德雷德的爪牙**，紅方一般角色。視野裡除了奧伯倫以外的紅方夥伴會被標記為 🔴。\n\n勝利條件：讓任務失敗 3 次，或刺客成功擊殺梅林。在任務上投失敗票，配合其他紅角破壞局勢。",

  "stage.board.fieldPlayers": "玩家",
  "stage.board.fieldRoundStatus": "任務狀態",
  "stage.board.fieldVoteStatus": "投票次數",
  "stage.board.fieldProgress": "任務進度",

  "stage.appoint.title": "第 {round} 輪：派任務",
  "stage.appoint.content": "由 {leader} 指派 **{num}** 員參與此次任務。",
  "stage.appoint.confirm": "確認",
  "stage.appoint.fieldRoster": "任務名單",
  "stage.appoint.fieldSelected": "目前選擇",
  "stage.appoint.selectedNone": "（尚未選擇）",

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
  "stage.publicVote.rejectionWarn": "連續否決 {n} / 5 — 達到 5 次紅方獲勝。",

  "stage.privateVote.title": "第 {round} 輪：任務投票",
  "stage.privateVote.content":
    "由 {leader} 指派的 **{num}** 員玩家正在執行任務 …",
  "stage.privateVote.openVote": "前往投票",
  "stage.privateVote.ephemeralPrompt": "請投出你的票",
  "stage.privateVote.success": "✅ 成功",
  "stage.privateVote.fail": "❎ 失敗",
  "stage.privateVote.need2Fail": "本輪 7 人以上需要兩張失敗票才會失敗。",
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
  "stage.lake.result": "{target} 的陣營：**{faction}**",
  "stage.lake.fieldHolder": "目前持有",

  "stage.assassinate.title": "刺殺階段",
  "stage.assassinate.content":
    "由刺客 {assassin} 選擇刺殺對象，若擊中梅林，紅方反敗為勝。",
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
  "role.flavor.merlin": "✨ 你是 **梅林** — 你看得見莫甘娜、刺客、奧伯倫（莫德雷德除外）。別讓刺客找出你。",
  "role.flavor.percival": "🛡 你是 **派西維爾** — 你看見梅林與莫甘娜，但分不清誰是誰。保護真正的梅林。",
  "role.flavor.assassin": "🗡 你是 **刺客** — 三次任務成功後，你有一次機會擊殺梅林、反敗為勝。",
  "role.flavor.morgana": "🎭 你是 **莫甘娜** — 派西維爾會把你誤認成梅林。儘量假裝藍方。",
  "role.flavor.mordred": "👑 你是 **莫德雷德** — 連梅林也看不見你，潛伏吧。",
  "role.flavor.oberon": "🦉 你是 **奧伯倫** — 你看不見隊友、隊友也看不見你。獨自破壞任務。",
  "role.flavor.loyal": "💙 你是 **亞瑟的忠臣** — 你看不見任何身份。觀察行為，跟隨梅林的暗示。",
  "role.flavor.minion": "🗡 你是 **莫德雷德的爪牙** — 你看得見除奧伯倫外的紅方夥伴，與其他紅角合作破壞任務。",
  "faction.arthur": "亞瑟陣營",
  "faction.mordred": "莫德雷德陣營",
} as const;

export type LocaleKey = keyof typeof zhTW;
