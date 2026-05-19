/**
 * Avalon-themed name pool for synthetic NPC players. Used at signup
 * time to give each NPC a distinct display name so the public board
 * reads as "湖中之女" rather than "NPC#3". Names are intentionally
 * generic Arthurian-ish flavour — not real historic figures — so
 * stylistic mismatch with the game's tone stays bounded.
 *
 * Sampling is without replacement; if the pool empties (only possible
 * with >30 NPCs, which the 10-player cap prevents) the helper falls
 * back to a numbered "騎士#N" so the call never throws.
 */

const NAME_POOL: ReadonlyArray<string> = [
  "蘭斯洛特",
  "高文",
  "崔斯坦",
  "加拉哈德",
  "波斯",
  "伊維因",
  "凱伊",
  "貝迪維爾",
  "佩里諾爾",
  "拉莫拉克",
  "薩格拉莫爾",
  "艾克托",
  "蓋瑞斯",
  "格雷夫雷特",
  "達古納特",
  "帕洛米德斯",
  "鮑爾斯",
  "湖夫人",
  "妮妙艾",
  "薇薇安",
  "伊蓮",
  "伊索德",
  "桂妮薇",
  "莫高絲",
  "依格蕾恩",
  "布蘭潔",
  "黎諾兒",
  "蘿薇娜",
  "希蘭",
  "艾諾爾",
];

/**
 * Pull `n` distinct display names, skipping any that collide with
 * `taken` (case-sensitive). Pool is shuffled per call so two NPCs
 * spawned back-to-back don't always get the same opener.
 */
export function sampleNpcDisplayNames(
  n: number,
  taken: Set<string>,
): string[] {
  const available = NAME_POOL.filter((name) => !taken.has(name));
  // Fisher–Yates on a local copy.
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (i < available.length) {
      out.push(available[i]);
    } else {
      // Exhausted the pool — fall back to a numbered placeholder.
      // The +1 keeps the user-facing index 1-based.
      let fallback = `騎士#${i + 1}`;
      let suffix = i + 1;
      while (taken.has(fallback) || out.includes(fallback)) {
        suffix++;
        fallback = `騎士#${suffix}`;
      }
      out.push(fallback);
    }
  }
  return out;
}
