// Countries for player profiles: ISO 3166-1 alpha-2 codes, names from the browser, flags as emoji.

const CODES = ('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF ' +
  'GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW ' +
  'KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL ' +
  'NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST ' +
  'SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW').split(' ');

let names: Intl.DisplayNames | null = null;
try { names = new Intl.DisplayNames(undefined, {type: 'region'}); } catch { /* old browser: codes only */ }

export const countryName = (code: string) => {
  try { return names?.of(code) ?? code; } catch { return code; }
};

/** 🇮🇳 from "IN". */
export const flag = (code: string) =>
  /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map(c => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

export const isCountry = (code: string) => CODES.includes(code);

/** All countries, sorted by name. */
export const COUNTRIES = CODES.map(code => ({code, name: countryName(code)})).sort((a, b) => a.name.localeCompare(b.name));

/** Best guess at the player's country from their browser language (e.g. en-IN → IN). */
export function guessCountry(): string {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const m = /[-_]([A-Z]{2})\b/i.exec(lang ?? '');
    if (m && isCountry(m[1].toUpperCase())) return m[1].toUpperCase();
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  const byZone: Record<string, string> = {'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Europe/London': 'GB', 'America/New_York': 'US',
    'America/Chicago': 'US', 'America/Los_Angeles': 'US', 'America/Denver': 'US', 'Asia/Tokyo': 'JP', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE',
    'Australia/Sydney': 'AU', 'America/Toronto': 'CA', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'America/Sao_Paulo': 'BR', 'Europe/Madrid': 'ES'};
  return byZone[tz] ?? '';
}
