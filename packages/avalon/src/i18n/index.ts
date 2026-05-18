import { zhTW, type LocaleKey } from "./zh-TW.js";

/**
 * Server-side i18n. The plugin is single-locale today (zh-TW); the
 * dictionary type is exported so adding `en` / `ja` later means
 * dropping in a sibling file with the same shape — no API churn.
 *
 * Discord interactions don't carry a locale in `ComponentContext`,
 * so for now the active locale is process-wide. A future per-guild
 * override (admin WebUI setting) plugs in at the call site:
 * `t(localeForGuild(guildId), "stage.signup.title", ...)`.
 */
export type Locale = "zh-TW";
const DEFAULT_LOCALE: Locale = "zh-TW";

const DICTIONARIES: Record<Locale, Record<LocaleKey, string>> = {
  "zh-TW": zhTW,
};

/**
 * Look up a translation key with simple `{var}` interpolation. Missing
 * keys log a warning and return the key itself so a typo is loud but
 * doesn't crash gameplay mid-round.
 */
export function t(
  locale: Locale | undefined,
  key: LocaleKey,
  vars: Record<string, string | number> = {},
): string {
  const dict = DICTIONARIES[locale ?? DEFAULT_LOCALE];
  let value: string = dict[key];
  if (value === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[i18n] missing key ${key} for locale ${locale}`);
    return key;
  }
  for (const [k, v] of Object.entries(vars)) {
    value = value.replaceAll(`{${k}}`, String(v));
  }
  return value;
}

export type { LocaleKey };
