import { DateTime } from 'luxon';
import type { Member, DayKey, DailySchedule, WeeklySchedule } from './db';

export type { DayKey, DailySchedule, WeeklySchedule };

export const DAY_KEYS: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export const WEEKDAY_TO_DAY_KEY: Record<number, DayKey> = {
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
  7: 'sun',
};

/**
 * Curated list of popular IANA timezones spanning global Discord communities.
 * Used for auto-complete and select inputs while preserving exact IANA identifiers.
 */
export const COMMON_IANA_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Madrid',
  'Europe/Rome',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Jerusalem',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'UTC',
] as const;

/**
 * Standard list of global GMT / UTC offsets spanning all inhabited timezones (-12:00 to +14:00).
 * Kept for backward compatibility and manual offset selections.
 */
export const GMT_OFFSETS = [
  'GMT-12:00',
  'GMT-11:00',
  'GMT-10:00',
  'GMT-09:30',
  'GMT-09:00',
  'GMT-08:00',
  'GMT-07:00',
  'GMT-06:00',
  'GMT-05:00',
  'GMT-04:00',
  'GMT-03:30',
  'GMT-03:00',
  'GMT-02:00',
  'GMT-01:00',
  'GMT+00:00',
  'GMT+01:00',
  'GMT+02:00',
  'GMT+03:00',
  'GMT+03:30',
  'GMT+04:00',
  'GMT+04:30',
  'GMT+05:00',
  'GMT+05:30',
  'GMT+05:45',
  'GMT+06:00',
  'GMT+06:30',
  'GMT+07:00',
  'GMT+08:00',
  'GMT+08:45',
  'GMT+09:00',
  'GMT+09:30',
  'GMT+10:00',
  'GMT+10:30',
  'GMT+11:00',
  'GMT+12:00',
  'GMT+12:45',
  'GMT+13:00',
  'GMT+14:00',
] as const;

export type GmtOffset = (typeof GMT_OFFSETS)[number];

/**
 * Translates any timezone identifier (strict IANA identifier, GMT offset, or bare offset)
 * into a specifier that Luxon's `DateTime.setZone()` natively supports (e.g. `UTC+05:30` or `Europe/Athens`).
 */
export function toValidLuxonZone(zoneStr: string | null | undefined): string {
  if (!zoneStr) return 'UTC';
  const clean = zoneStr.trim();
  if (/^GMT$/i.test(clean) || /^UTC$/i.test(clean)) return 'UTC';

  // Format: GMT+05:30, GMT-5, GMT+5:30
  const gmtMatch = clean.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (gmtMatch) {
    const sign = gmtMatch[1];
    const hours = parseInt(gmtMatch[2], 10);
    const mins = gmtMatch[3] ? parseInt(gmtMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // Bare offset format: +05:30, -05:00, +5, -8
  const offsetMatch = clean.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (offsetMatch) {
    const sign = offsetMatch[1];
    const hours = parseInt(offsetMatch[2], 10);
    const mins = offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  // UTC offset format: UTC+05:30, UTC-5
  const utcMatch = clean.match(/^UTC([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (utcMatch) {
    const sign = utcMatch[1];
    const hours = parseInt(utcMatch[2], 10);
    const mins = utcMatch[3] ? parseInt(utcMatch[3], 10) : 0;
    if (hours > 14 || mins >= 60) return 'invalid';
    return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  return clean;
}

/**
 * Validates whether the given string represents a valid IANA timezone identifier or supported offset in Luxon.
 */
export function isValidTimezone(zoneStr: string | null | undefined): boolean {
  if (!zoneStr || typeof zoneStr !== 'string') return false;
  const luxonZone = toValidLuxonZone(zoneStr);
  if (luxonZone === 'invalid') return false;
  return DateTime.now().setZone(luxonZone).isValid;
}

/**
 * Converts any timezone identifier (including IANA city names) into a
 * standard `GMT±HH:mm` representation for UI display and location privacy.
 */
export function formatGmtOffset(zoneStr: string | null | undefined): string {
  if (!zoneStr) return 'GMT+00:00';
  const clean = zoneStr.trim();
  const luxonZone = toValidLuxonZone(clean);
  const dt = DateTime.now().setZone(luxonZone);
  if (!dt.isValid) return clean.startsWith('GMT') ? clean : 'GMT+00:00';
  return `GMT${dt.toFormat('ZZ')}`;
}

/**
 * Automatically captures the local system IANA timezone using the Intl API.
 * Falls back to 'UTC' if detection fails or runs on an unsupported runtime.
 */
export function detectUserTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && isValidTimezone(detected)) {
      return detected;
    }
  } catch {
    // Ignore runtime exceptions in non-browser or sandbox environments
  }
  return 'UTC';
}

/**
 * Baseline canonical IANA timezones spanning all global territories, countries, and cities.
 * Guaranteed to exist across all runtime environments (Node.js, edge, browser, SSR).
 */
export const BASE_IANA_TIMEZONES = [
  'Africa/Abidjan',
  'Africa/Accra',
  'Africa/Addis_Ababa',
  'Africa/Algiers',
  'Africa/Asmera',
  'Africa/Bamako',
  'Africa/Bangui',
  'Africa/Banjul',
  'Africa/Bissau',
  'Africa/Blantyre',
  'Africa/Brazzaville',
  'Africa/Bujumbura',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Ceuta',
  'Africa/Conakry',
  'Africa/Dakar',
  'Africa/Dar_es_Salaam',
  'Africa/Djibouti',
  'Africa/Douala',
  'Africa/El_Aaiun',
  'Africa/Freetown',
  'Africa/Gaborone',
  'Africa/Harare',
  'Africa/Johannesburg',
  'Africa/Juba',
  'Africa/Kampala',
  'Africa/Khartoum',
  'Africa/Kigali',
  'Africa/Kinshasa',
  'Africa/Lagos',
  'Africa/Libreville',
  'Africa/Lome',
  'Africa/Luanda',
  'Africa/Lubumbashi',
  'Africa/Lusaka',
  'Africa/Malabo',
  'Africa/Maputo',
  'Africa/Maseru',
  'Africa/Mbabane',
  'Africa/Mogadishu',
  'Africa/Monrovia',
  'Africa/Nairobi',
  'Africa/Ndjamena',
  'Africa/Niamey',
  'Africa/Nouakchott',
  'Africa/Ouagadougou',
  'Africa/Porto-Novo',
  'Africa/Sao_Tome',
  'Africa/Tripoli',
  'Africa/Tunis',
  'Africa/Windhoek',
  'America/Adak',
  'America/Anchorage',
  'America/Anguilla',
  'America/Antigua',
  'America/Araguaina',
  'America/Argentina/La_Rioja',
  'America/Argentina/Rio_Gallegos',
  'America/Argentina/Salta',
  'America/Argentina/San_Juan',
  'America/Argentina/San_Luis',
  'America/Argentina/Tucuman',
  'America/Argentina/Ushuaia',
  'America/Aruba',
  'America/Asuncion',
  'America/Bahia',
  'America/Bahia_Banderas',
  'America/Barbados',
  'America/Belem',
  'America/Belize',
  'America/Blanc-Sablon',
  'America/Boa_Vista',
  'America/Bogota',
  'America/Boise',
  'America/Buenos_Aires',
  'America/Cambridge_Bay',
  'America/Campo_Grande',
  'America/Cancun',
  'America/Caracas',
  'America/Catamarca',
  'America/Cayenne',
  'America/Cayman',
  'America/Chicago',
  'America/Chihuahua',
  'America/Ciudad_Juarez',
  'America/Coral_Harbour',
  'America/Cordoba',
  'America/Costa_Rica',
  'America/Coyhaique',
  'America/Creston',
  'America/Cuiaba',
  'America/Curacao',
  'America/Danmarkshavn',
  'America/Dawson',
  'America/Dawson_Creek',
  'America/Denver',
  'America/Detroit',
  'America/Dominica',
  'America/Edmonton',
  'America/Eirunepe',
  'America/El_Salvador',
  'America/Fort_Nelson',
  'America/Fortaleza',
  'America/Glace_Bay',
  'America/Godthab',
  'America/Goose_Bay',
  'America/Grand_Turk',
  'America/Grenada',
  'America/Guadeloupe',
  'America/Guatemala',
  'America/Guayaquil',
  'America/Guyana',
  'America/Halifax',
  'America/Havana',
  'America/Hermosillo',
  'America/Indiana/Knox',
  'America/Indiana/Marengo',
  'America/Indiana/Petersburg',
  'America/Indiana/Tell_City',
  'America/Indiana/Vevay',
  'America/Indiana/Vincennes',
  'America/Indiana/Winamac',
  'America/Indianapolis',
  'America/Inuvik',
  'America/Iqaluit',
  'America/Jamaica',
  'America/Jujuy',
  'America/Juneau',
  'America/Kentucky/Monticello',
  'America/Kralendijk',
  'America/La_Paz',
  'America/Lima',
  'America/Los_Angeles',
  'America/Louisville',
  'America/Lower_Princes',
  'America/Maceio',
  'America/Managua',
  'America/Manaus',
  'America/Marigot',
  'America/Martinique',
  'America/Matamoros',
  'America/Mazatlan',
  'America/Mendoza',
  'America/Menominee',
  'America/Merida',
  'America/Metlakatla',
  'America/Mexico_City',
  'America/Miquelon',
  'America/Moncton',
  'America/Monterrey',
  'America/Montevideo',
  'America/Montserrat',
  'America/Nassau',
  'America/New_York',
  'America/Nome',
  'America/Noronha',
  'America/North_Dakota/Beulah',
  'America/North_Dakota/Center',
  'America/North_Dakota/New_Salem',
  'America/Ojinaga',
  'America/Panama',
  'America/Paramaribo',
  'America/Phoenix',
  'America/Port-au-Prince',
  'America/Port_of_Spain',
  'America/Porto_Velho',
  'America/Puerto_Rico',
  'America/Punta_Arenas',
  'America/Rankin_Inlet',
  'America/Recife',
  'America/Regina',
  'America/Resolute',
  'America/Rio_Branco',
  'America/Santarem',
  'America/Santiago',
  'America/Santo_Domingo',
  'America/Sao_Paulo',
  'America/Scoresbysund',
  'America/Sitka',
  'America/St_Barthelemy',
  'America/St_Johns',
  'America/St_Kitts',
  'America/St_Lucia',
  'America/St_Thomas',
  'America/St_Vincent',
  'America/Swift_Current',
  'America/Tegucigalpa',
  'America/Thule',
  'America/Tijuana',
  'America/Toronto',
  'America/Tortola',
  'America/Vancouver',
  'America/Whitehorse',
  'America/Winnipeg',
  'America/Yakutat',
  'Antarctica/Casey',
  'Antarctica/Davis',
  'Antarctica/DumontDUrville',
  'Antarctica/Macquarie',
  'Antarctica/Mawson',
  'Antarctica/McMurdo',
  'Antarctica/Palmer',
  'Antarctica/Rothera',
  'Antarctica/Syowa',
  'Antarctica/Troll',
  'Antarctica/Vostok',
  'Arctic/Longyearbyen',
  'Asia/Aden',
  'Asia/Almaty',
  'Asia/Amman',
  'Asia/Anadyr',
  'Asia/Aqtau',
  'Asia/Aqtobe',
  'Asia/Ashgabat',
  'Asia/Atyrau',
  'Asia/Baghdad',
  'Asia/Bahrain',
  'Asia/Baku',
  'Asia/Bangkok',
  'Asia/Barnaul',
  'Asia/Beirut',
  'Asia/Bishkek',
  'Asia/Brunei',
  'Asia/Calcutta',
  'Asia/Chita',
  'Asia/Colombo',
  'Asia/Damascus',
  'Asia/Dhaka',
  'Asia/Dili',
  'Asia/Dubai',
  'Asia/Dushanbe',
  'Asia/Famagusta',
  'Asia/Gaza',
  'Asia/Hebron',
  'Asia/Hong_Kong',
  'Asia/Hovd',
  'Asia/Ho_Chi_Minh',
  'Asia/Irkutsk',
  'Asia/Jakarta',
  'Asia/Jayapura',
  'Asia/Jerusalem',
  'Asia/Kabul',
  'Asia/Kamchatka',
  'Asia/Karachi',
  'Asia/Kathmandu',
  'Asia/Katmandu',
  'Asia/Khandyga',
  'Asia/Kolkata',
  'Asia/Krasnoyarsk',
  'Asia/Kuala_Lumpur',
  'Asia/Kuching',
  'Asia/Kuwait',
  'Asia/Macau',
  'Asia/Magadan',
  'Asia/Makassar',
  'Asia/Manila',
  'Asia/Muscat',
  'Asia/Nicosia',
  'Asia/Novokuznetsk',
  'Asia/Novosibirsk',
  'Asia/Omsk',
  'Asia/Oral',
  'Asia/Phnom_Penh',
  'Asia/Pontianak',
  'Asia/Pyongyang',
  'Asia/Qatar',
  'Asia/Qostanay',
  'Asia/Qyzylorda',
  'Asia/Rangoon',
  'Asia/Riyadh',
  'Asia/Saigon',
  'Asia/Sakhalin',
  'Asia/Samarkand',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Srednekolymsk',
  'Asia/Taipei',
  'Asia/Tashkent',
  'Asia/Tbilisi',
  'Asia/Tehran',
  'Asia/Thimphu',
  'Asia/Tokyo',
  'Asia/Tomsk',
  'Asia/Ulaanbaatar',
  'Asia/Urumqi',
  'Asia/Ust-Nera',
  'Asia/Vientiane',
  'Asia/Vladivostok',
  'Asia/Yakutsk',
  'Asia/Yangon',
  'Asia/Yekaterinburg',
  'Asia/Yerevan',
  'Atlantic/Azores',
  'Atlantic/Bermuda',
  'Atlantic/Canary',
  'Atlantic/Cape_Verde',
  'Atlantic/Faeroe',
  'Atlantic/Madeira',
  'Atlantic/Reykjavik',
  'Atlantic/South_Georgia',
  'Atlantic/St_Helena',
  'Atlantic/Stanley',
  'Australia/Adelaide',
  'Australia/Brisbane',
  'Australia/Broken_Hill',
  'Australia/Darwin',
  'Australia/Eucla',
  'Australia/Hobart',
  'Australia/Lindeman',
  'Australia/Lord_Howe',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Sydney',
  'Europe/Amsterdam',
  'Europe/Andorra',
  'Europe/Astrakhan',
  'Europe/Athens',
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/Bratislava',
  'Europe/Brussels',
  'Europe/Bucharest',
  'Europe/Budapest',
  'Europe/Busingen',
  'Europe/Chisinau',
  'Europe/Copenhagen',
  'Europe/Dublin',
  'Europe/Gibraltar',
  'Europe/Guernsey',
  'Europe/Helsinki',
  'Europe/Isle_of_Man',
  'Europe/Istanbul',
  'Europe/Jersey',
  'Europe/Kaliningrad',
  'Europe/Kiev',
  'Europe/Kyiv',
  'Europe/Kirov',
  'Europe/Lisbon',
  'Europe/Ljubljana',
  'Europe/London',
  'Europe/Luxembourg',
  'Europe/Madrid',
  'Europe/Malta',
  'Europe/Mariehamn',
  'Europe/Minsk',
  'Europe/Monaco',
  'Europe/Moscow',
  'Europe/Oslo',
  'Europe/Paris',
  'Europe/Podgorica',
  'Europe/Prague',
  'Europe/Riga',
  'Europe/Rome',
  'Europe/Samara',
  'Europe/San_Marino',
  'Europe/Sarajevo',
  'Europe/Saratov',
  'Europe/Simferopol',
  'Europe/Skopje',
  'Europe/Sofia',
  'Europe/Stockholm',
  'Europe/Tallinn',
  'Europe/Tirane',
  'Europe/Ulyanovsk',
  'Europe/Vaduz',
  'Europe/Vatican',
  'Europe/Vienna',
  'Europe/Vilnius',
  'Europe/Volgograd',
  'Europe/Warsaw',
  'Europe/Zagreb',
  'Europe/Zurich',
  'Indian/Antananarivo',
  'Indian/Chagos',
  'Indian/Christmas',
  'Indian/Cocos',
  'Indian/Comoro',
  'Indian/Kerguelen',
  'Indian/Mahe',
  'Indian/Maldives',
  'Indian/Mauritius',
  'Indian/Mayotte',
  'Indian/Reunion',
  'Pacific/Apia',
  'Pacific/Auckland',
  'Pacific/Bougainville',
  'Pacific/Chatham',
  'Pacific/Easter',
  'Pacific/Efate',
  'Pacific/Enderbury',
  'Pacific/Fakaofo',
  'Pacific/Fiji',
  'Pacific/Funafuti',
  'Pacific/Galapagos',
  'Pacific/Gambier',
  'Pacific/Guadalcanal',
  'Pacific/Guam',
  'Pacific/Honolulu',
  'Pacific/Kiritimati',
  'Pacific/Kosrae',
  'Pacific/Kwajalein',
  'Pacific/Majuro',
  'Pacific/Marquesas',
  'Pacific/Midway',
  'Pacific/Nauru',
  'Pacific/Niue',
  'Pacific/Norfolk',
  'Pacific/Noumea',
  'Pacific/Pago_Pago',
  'Pacific/Palau',
  'Pacific/Pitcairn',
  'Pacific/Ponape',
  'Pacific/Port_Moresby',
  'Pacific/Rarotonga',
  'Pacific/Saipan',
  'Pacific/Tahiti',
  'Pacific/Tarawa',
  'Pacific/Tongatapu',
  'Pacific/Truk',
  'Pacific/Wake',
  'Pacific/Wallis',
  'UTC',
] as const;

/**
 * Complete list of all canonical IANA timezones, enriched dynamically from runtime Intl API if available.
 */
export const ALL_IANA_TIMEZONES: readonly string[] = (() => {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const runtimeZones = Intl.supportedValuesOf('timeZone');
      if (runtimeZones && runtimeZones.length > 0) {
        const merged = new Set([
          ...BASE_IANA_TIMEZONES,
          ...runtimeZones,
          'Asia/Kolkata',
          'Asia/Kathmandu',
          'Asia/Ho_Chi_Minh',
          'Asia/Yangon',
          'Europe/Kyiv',
          'UTC',
        ]);
        return Array.from(merged).filter(isValidTimezone).sort();
      }
    }
  } catch {
    // Fall back to BASE_IANA_TIMEZONES on non-supporting runtimes
  }
  return BASE_IANA_TIMEZONES.filter(isValidTimezone);
})();

/**
 * Complete union of all global timezones: GMT offsets (-12:00 to +14:00) and all canonical IANA timezones.
 */
export const ALL_TIMEZONES: readonly string[] = [...GMT_OFFSETS, ...ALL_IANA_TIMEZONES];

export interface TimezoneOption {
  value: string;
  label: string;
}

export interface TimezoneGroup {
  label: string;
  options: TimezoneOption[];
}

const ALL_TIMEZONES_SET = new Set<string>([...GMT_OFFSETS, ...ALL_IANA_TIMEZONES]);

/**
 * Checks whether the given string is recognized in our comprehensive timezone catalog or valid in Luxon.
 */
export function isKnownTimezone(zoneStr: string | null | undefined): boolean {
  if (!zoneStr || typeof zoneStr !== 'string') return false;
  const clean = zoneStr.trim();
  return ALL_TIMEZONES_SET.has(clean) || isValidTimezone(clean);
}

/**
 * Normalizes a user search query for offset matching (e.g. "+5", "-5", "GMT+5", "+5:30").
 */
function normalizeOffsetQuery(q: string): { isOffset: boolean; sign?: string; h?: string; m?: string } {
  const trimmed = q.trim().toLowerCase();
  const offsetMatch = trimmed.match(/^(?:gmt|utc)?([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (offsetMatch) {
    const sign = offsetMatch[1];
    const h = String(parseInt(offsetMatch[2], 10)).padStart(2, '0');
    const m = offsetMatch[3] ? offsetMatch[3] : '';
    return { isOffset: true, sign, h, m };
  }
  return { isOffset: false };
}

/**
 * Matches a timezone identifier and formatted label against a search query.
 */
export function matchesTimezoneQuery(value: string, label: string, query: string): boolean {
  if (!query || !query.trim()) return true;
  const nq = normalizeOffsetQuery(query);
  const lowerLabel = label.toLowerCase();
  const lowerValue = value.toLowerCase();
  const cleanLabel = lowerLabel.replace(/_/g, ' ');
  const cleanValue = lowerValue.replace(/_/g, ' ');

  if (nq.isOffset && nq.sign && nq.h) {
    if (nq.m) {
      const fullOffset = nq.sign + nq.h + ':' + nq.m;
      const shortOffset = nq.sign + parseInt(nq.h, 10) + ':' + nq.m;
      return (
        lowerLabel.includes(fullOffset) ||
        lowerValue.includes(fullOffset) ||
        lowerLabel.includes(shortOffset) ||
        lowerValue.includes(shortOffset)
      );
    } else {
      // Hour-only query: match a complete hour token (e.g. +01:, +1:, or token boundary)
      // to avoid matching longer hour values such as +1 against +10..+14, while preserving
      // partial-minute matches (e.g. +5 matching GMT+05:30)
      const escapedSign = nq.sign === '+' ? '\\+' : '-';
      const hourRegex = new RegExp(`(?:gmt|utc)?${escapedSign}(?:${nq.h}|${parseInt(nq.h, 10)})(?::|\\b|$)`, 'i');
      return hourRegex.test(lowerLabel) || hourRegex.test(lowerValue);
    }
  }

  const rawQ = query.toLowerCase().trim();
  const qSpaced = rawQ.replace(/_/g, ' ');
  return (
    cleanLabel.includes(qSpaced) ||
    cleanValue.includes(qSpaced) ||
    lowerLabel.includes(rawQ) ||
    lowerValue.includes(rawQ)
  );
}

/**
 * Builds categorized timezone groups for UI selection (Popular, GMT Offsets, Americas, Europe, Asia, Africa, Oceania, Other).
 */
export function getTimezoneGroups(): TimezoneGroup[] {
  const commonOptions: TimezoneOption[] = COMMON_IANA_TIMEZONES.map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const gmtOptions: TimezoneOption[] = GMT_OFFSETS.map((tz) => ({
    value: tz,
    label: tz,
  }));

  const americasOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter((tz) =>
    tz.startsWith('America/')
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const europeOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter((tz) =>
    tz.startsWith('Europe/')
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const asiaOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter((tz) =>
    tz.startsWith('Asia/')
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const africaOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter((tz) =>
    tz.startsWith('Africa/')
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const oceaniaOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter(
    (tz) => tz.startsWith('Australia/') || tz.startsWith('Pacific/')
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  const otherOptions: TimezoneOption[] = ALL_IANA_TIMEZONES.filter(
    (tz) =>
      tz.startsWith('Atlantic/') ||
      tz.startsWith('Indian/') ||
      tz.startsWith('Antarctica/') ||
      tz.startsWith('Arctic/') ||
      tz === 'UTC'
  ).map((tz) => ({
    value: tz,
    label: `${tz} (${formatGmtOffset(tz)})`,
  }));

  return [
    { label: 'Popular Timezones', options: commonOptions },
    { label: 'Standard GMT Offsets', options: gmtOptions },
    { label: 'Americas', options: americasOptions },
    { label: 'Europe', options: europeOptions },
    { label: 'Asia', options: asiaOptions },
    { label: 'Africa', options: africaOptions },
    { label: 'Oceania & Pacific', options: oceaniaOptions },
    { label: 'Atlantic, Indian & Polar', options: otherOptions },
  ];
}

/**
 * Filters timezone groups and their child options according to a search query.
 */
export function filterTimezoneGroups(groups: TimezoneGroup[], query: string): TimezoneGroup[] {
  if (!query || !query.trim()) return groups;
  return groups
    .map((g) => ({
      label: g.label,
      options: g.options.filter((opt) => matchesTimezoneQuery(opt.value, opt.label, query)),
    }))
    .filter((g) => g.options.length > 0);
}

export type SleepBucket =
  | 'BEDTIME_NOW'
  | 'BEDTIME_GRACE'
  | 'OVERDUE_NAG_NOW'
  | 'WINDING_DOWN'
  | 'SLEEPING'
  | 'AWAKE';

export type SleepStatus =
  | 'BEDTIME_GRACE'
  | 'OVERDUE_NAG_NOW'
  | 'WINDING_DOWN'
  | 'SLEEPING'
  | 'AWAKE';

export interface StreakMilestone {
  title: string;
  badgeLabel: string;
  icon: string;
  color: string;
  description: string;
}

export interface MemberState {
  bucket: SleepBucket;
  status: SleepStatus;
  statusText: string;
  isSleepShieldActive: boolean;
  formattedViewerTime: string;
  formattedSleeperTime: string;
  formattedWakeTime?: string;
  diffMinutes: number;
  graceMinutesLeft?: number;
  canVoteStrike?: boolean;
  pendingNotice?: string | null;
  checkedInEarly?: boolean;
  streakMilestone?: StreakMilestone | null;
  isWeekendSchedule?: boolean;
  isCustomScheduleToday?: boolean;
  activeBedtimeLocal?: string;
  activeWakeTimeLocal?: string;
  dayKey?: DayKey;
  needsWakeUpLog?: boolean;
  isPastWakeTime?: boolean;
  hasLoggedWakeUp?: boolean;
}

/**
 * Checks and promotes pending schedule if 48-hour cooldown has elapsed.
 */
export function checkCooldownPromotion(
  member: Member,
  nowUtc = DateTime.utc()
): {
  promoted: boolean;
  activeMember: Member;
} {
  if (!member.pending_effective_at) {
    return { promoted: false, activeMember: member };
  }

  const effectiveAt = DateTime.fromISO(member.pending_effective_at, { zone: 'utc' });

  if (nowUtc >= effectiveAt) {
    const nextWeekendBedtime =
      member.pending_weekend_bedtime_local !== undefined
        ? (member.pending_weekend_bedtime_local || null)
        : (member.weekend_bedtime_local || null);
    const nextWeekendWakeTime =
      member.pending_weekend_wake_time_local !== undefined
        ? (member.pending_weekend_wake_time_local || null)
        : (member.weekend_wake_time_local || null);

    let nextWeeklySchedule: WeeklySchedule | null = member.pending_weekly_schedule || null;
    if (
      !nextWeeklySchedule &&
      (member.pending_bedtime_local ||
        member.pending_wake_time_local ||
        member.pending_weekend_bedtime_local !== undefined ||
        member.pending_weekend_wake_time_local !== undefined)
    ) {
      const baseBed = member.pending_bedtime_local || member.bedtime_local;
      const baseWake = member.pending_wake_time_local || member.wake_time_local;
      const baseWeekendBed =
        member.pending_weekend_bedtime_local !== undefined
          ? member.pending_weekend_bedtime_local || baseBed
          : member.weekend_bedtime_local || baseBed;
      const baseWeekendWake =
        member.pending_weekend_wake_time_local !== undefined
          ? member.pending_weekend_wake_time_local || baseWake
          : member.weekend_wake_time_local || baseWake;

      if (member.weekly_schedule) {
        const cloned = JSON.parse(JSON.stringify(member.weekly_schedule)) as WeeklySchedule;
        const weekdays: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'sun'];
        const weekends: DayKey[] = ['fri', 'sat'];
        if (member.pending_bedtime_local) {
          for (const d of weekdays) cloned[d].bedtime = member.pending_bedtime_local;
        }
        if (member.pending_wake_time_local) {
          for (const d of weekdays) cloned[d].wake_time = member.pending_wake_time_local;
        }
        if (member.pending_weekend_bedtime_local !== undefined) {
          for (const d of weekends) cloned[d].bedtime = baseWeekendBed;
        }
        if (member.pending_weekend_wake_time_local !== undefined) {
          for (const d of weekends) cloned[d].wake_time = baseWeekendWake;
        }
        nextWeeklySchedule = cloned;
      } else {
        nextWeeklySchedule = {
          mon: { bedtime: baseBed, wake_time: baseWake },
          tue: { bedtime: baseBed, wake_time: baseWake },
          wed: { bedtime: baseBed, wake_time: baseWake },
          thu: { bedtime: baseBed, wake_time: baseWake },
          fri: { bedtime: baseWeekendBed, wake_time: baseWeekendWake },
          sat: { bedtime: baseWeekendBed, wake_time: baseWeekendWake },
          sun: { bedtime: baseBed, wake_time: baseWake },
        };
      }
    } else if (!nextWeeklySchedule) {
      nextWeeklySchedule = member.weekly_schedule || null;
    }

    const updated: Member = {
      ...member,
      bedtime_local: member.pending_bedtime_local || member.bedtime_local,
      wake_time_local: member.pending_wake_time_local || member.wake_time_local,
      timezone: member.pending_timezone || member.timezone,
      weekend_bedtime_local: nextWeekendBedtime,
      weekend_wake_time_local: nextWeekendWakeTime,
      weekly_schedule: nextWeeklySchedule,
      pending_bedtime_local: null,
      pending_wake_time_local: null,
      pending_timezone: null,
      pending_weekend_bedtime_local: null,
      pending_weekend_wake_time_local: null,
      pending_weekly_schedule: null,
      pending_effective_at: null,
    };
    return { promoted: true, activeMember: updated };
  }

  return { promoted: false, activeMember: member };
}

/**
 * Calculates consecutive sleep check-in streak in days.
 * @param checkinDates Array of distinct local dates ("YYYY-MM-DD") the member checked in
 * @param sleeperNow Current DateTime in the sleeper's timezone
 */
export function calculateSleepStreak(
  checkinDates: string[],
  sleeperNow: DateTime
): number {
  if (!checkinDates || checkinDates.length === 0) return 0;

  const dateSet = new Set(checkinDates);
  const todayStr = sleeperNow.toISODate();
  const yesterdayStr = sleeperNow.minus({ days: 1 }).toISODate();

  if (!todayStr || !yesterdayStr) return 0;

  let currentStreak = 0;
  let checkCursor = sleeperNow;

  if (dateSet.has(todayStr)) {
    currentStreak = 1;
    checkCursor = sleeperNow.minus({ days: 1 });
  } else if (dateSet.has(yesterdayStr)) {
    // If not checked in today yet, but checked in yesterday, the streak is still alive
    currentStreak = 1;
    checkCursor = sleeperNow.minus({ days: 2 });
  } else {
    return 0;
  }

  while (true) {
    const cursorStr = checkCursor.toISODate();
    if (cursorStr && dateSet.has(cursorStr)) {
      currentStreak++;
      checkCursor = checkCursor.minus({ days: 1 });
    } else {
      break;
    }
  }

  return currentStreak;
}

/**
 * Returns celebratory mascot milestone badges for consistent sleep streaks.
 */
export function getStreakMilestoneBadge(streakDays: number): StreakMilestone | null {
  if (!streakDays || streakDays <= 0) return null;

  if (streakDays >= 30) {
    return {
      title: 'Grand Slumber Fox',
      badgeLabel: '30d Master',
      icon: '👑',
      color: 'text-status-amber border-status-amber/40 bg-status-amber/10',
      description: '30 consecutive days of on-time bedtime!',
    };
  }
  if (streakDays >= 14) {
    return {
      title: 'Night Guardian Fox',
      badgeLabel: '14d Guard',
      icon: '🥇',
      color: 'text-status-coral border-status-coral/40 bg-status-coral/10',
      description: '14 consecutive days of consistent sleep!',
    };
  }
  if (streakDays >= 7) {
    return {
      title: 'Dream Weaver Fox',
      badgeLabel: '7d Dreamer',
      icon: '🥈',
      color: 'text-status-sage border-status-sage/40 bg-status-sage/10',
      description: '1 full week of hitting bedtime!',
    };
  }
  if (streakDays >= 3) {
    return {
      title: 'Cozy Den Kit',
      badgeLabel: '3d Cozy',
      icon: '🥉',
      color: 'text-status-amber border-status-amber/40 bg-status-amber/10',
      description: '3 consecutive days on track!',
    };
  }

  return {
    title: 'First Snooze',
    badgeLabel: `${streakDays}d streak`,
    icon: '🔥',
    color: 'text-cream-secondary border-night-border bg-night-elevated',
    description: `${streakDays} consecutive day on track.`,
  };
}

/**
 * Determines whether a given night date falls on a weekend night.
 * Weekend nights are explicitly defined as Friday nights and Saturday nights.
 * In Luxon: 5 = Friday, 6 = Saturday.
 */
export function isWeekendNight(dt: DateTime): boolean {
  return dt.weekday === 5 || dt.weekday === 6;
}

/**
 * Returns the DailySchedule ({ bedtime, wake_time }) for a given date.
 * Maps Luxon's weekday (1 = Monday ... 7 = Sunday) to DayKey ('mon' ... 'sun').
 * Reads member.weekly_schedule?.[dayKey] if valid.
 * Falls back gracefully to weekend_bedtime / weekend_wake_time (for Friday/Saturday)
 * and base bedtime / wake_time if weekly_schedule is null or missing.
 */
export function getScheduleForDay(
  member: Member,
  luxonDateTime: DateTime
): DailySchedule {
  const dayKey: DayKey = WEEKDAY_TO_DAY_KEY[luxonDateTime.weekday] || 'mon';
  const customDay = member.weekly_schedule?.[dayKey];

  if (
    customDay &&
    typeof customDay.bedtime === 'string' &&
    customDay.bedtime.trim() !== '' &&
    typeof customDay.wake_time === 'string' &&
    customDay.wake_time.trim() !== ''
  ) {
    return {
      bedtime: customDay.bedtime.trim(),
      wake_time: customDay.wake_time.trim(),
    };
  }

  // Graceful fallback to legacy weekend and weekday columns
  const isWeekend = isWeekendNight(luxonDateTime);
  const fallbackWeekendBedtime =
    member.weekend_bedtime_local || (member as any).weekend_bedtime || null;
  const fallbackWeekendWakeTime =
    member.weekend_wake_time_local || (member as any).weekend_wake_time || null;

  const baseBedtime =
    member.bedtime_local || (member as any).bedtime || '23:00';
  const baseWakeTime =
    member.wake_time_local || (member as any).wake_time || '07:00';

  const resolvedBedtime =
    isWeekend && fallbackWeekendBedtime && fallbackWeekendBedtime.trim() !== ''
      ? fallbackWeekendBedtime.trim()
      : baseBedtime.trim();

  const resolvedWakeTime =
    isWeekend && fallbackWeekendWakeTime && fallbackWeekendWakeTime.trim() !== ''
      ? fallbackWeekendWakeTime.trim()
      : baseWakeTime.trim();

  return {
    bedtime: resolvedBedtime,
    wake_time: resolvedWakeTime,
  };
}

/**
 * Returns the effective bedtime string and whether weekend hours apply for a given night date.
 */
export function getBedtimeForNight(
  member: Member,
  nightDate: DateTime
): { bedtimeStr: string; isWeekend: boolean } {
  const isWeekend = isWeekendNight(nightDate);
  const sched = getScheduleForDay(member, nightDate);

  const nightSched = getScheduleForDay(member, nightDate);
  const hasWeekendOverride = member.weekly_schedule
    ? ([1, 2, 3, 4, 5, 6, 7] as const).some((weekday) => {
        const other = getScheduleForDay(member, nightDate.set({ weekday }));
        return other.bedtime !== nightSched.bedtime || other.wake_time !== nightSched.wake_time;
      })
    : Boolean(member.weekend_bedtime_local && member.weekend_bedtime_local.trim() !== '');

  return {
    bedtimeStr: sched.bedtime,
    isWeekend: isWeekend && hasWeekendOverride,
  };
}

/**
 * Calculates the exact DateTime when a given night's bedtime occurs in the sleeper's IANA timezone.
 * If bedtime hour >= 12, it takes place on the nightDate calendar day (e.g. Friday 23:30).
 * If bedtime hour < 12, it takes place on the following calendar day morning (e.g. Friday night's 01:00 AM sleep hits Saturday 01:00 AM).
 * Preserves the IANA zone to accurately account for Daylight Saving Time (DST) transitions.
 */
export function getNightBedtimeDateTime(
  member: Member,
  nightDate: DateTime
): { bedtimeDateTime: DateTime; isWeekend: boolean; bedtimeStr: string } {
  const { bedtimeStr, isWeekend } = getBedtimeForNight(member, nightDate);
  const [hours, minutes] = bedtimeStr.split(':').map(Number);
  const h = hours || 0;
  const m = minutes || 0;

  const baseDate = h < 12 ? nightDate.plus({ days: 1 }) : nightDate;

  const bedtimeDateTime = baseDate.set({
    hour: h,
    minute: m,
    second: 0,
    millisecond: 0,
  });

  return { bedtimeDateTime, isWeekend, bedtimeStr };
}

/**
 * Calculates both bedtime and morning wake-up DateTimes for a given night in sleeper's local zone.
 */
export function getNightScheduleDateTime(
  member: Member,
  nightDate: DateTime
): {
  bedtimeDateTime: DateTime;
  wakeDateTime: DateTime;
  isWeekend: boolean;
  bedtimeStr: string;
  wakeTimeStr: string;
  dayKey: DayKey;
} {
  const dayKey: DayKey = WEEKDAY_TO_DAY_KEY[nightDate.weekday] || 'mon';
  const sched = getScheduleForDay(member, nightDate);
  const isWeekend = isWeekendNight(nightDate);
  const [bH, bM] = sched.bedtime.split(':').map(Number);
  const [wH, wM] = sched.wake_time.split(':').map(Number);

  const bedtimeBase = (bH || 0) < 12 ? nightDate.plus({ days: 1 }) : nightDate;
  const bedtimeDateTime = bedtimeBase.set({
    hour: bH || 0,
    minute: bM || 0,
    second: 0,
    millisecond: 0,
  });

  let wakeDateTime = nightDate.plus({ days: 1 }).set({
    hour: wH !== undefined && !isNaN(wH) ? wH : 7,
    minute: wM !== undefined && !isNaN(wM) ? wM : 0,
    second: 0,
    millisecond: 0,
  });
  if (wakeDateTime <= bedtimeDateTime) {
    wakeDateTime = wakeDateTime.plus({ days: 1 });
  }

  const nightSched = getScheduleForDay(member, nightDate);
  const hasWeekendOverride = member.weekly_schedule
    ? ([1, 2, 3, 4, 5, 6, 7] as const).some((weekday) => {
        const other = getScheduleForDay(member, nightDate.set({ weekday }));
        return other.bedtime !== nightSched.bedtime || other.wake_time !== nightSched.wake_time;
      })
    : Boolean(member.weekend_bedtime_local && member.weekend_bedtime_local.trim() !== '');

  return {
    bedtimeDateTime,
    wakeDateTime,
    isWeekend: isWeekend && hasWeekendOverride,
    bedtimeStr: sched.bedtime,
    wakeTimeStr: sched.wake_time,
    dayKey,
  };
}

/**
 * Resolves the active sleep cycle schedule and cycle night date for a member at a given moment in their timezone.
 *
 * Evaluation Order:
 * 1. Yesterday's Cycle Check First: Check if now still falls inside the active sleep/wake window
 *    initiated on the previous calendar day (now.minus({ days: 1 })).
 *    Evaluates against yesterday's sleep cycle until yesterday's wake_time (plus any active in-bed/overflow window)
 *    has elapsed.
 * 2. Today's Cycle Check Second: Once yesterday's wake window has completed, resolves today's
 *    target bedtime and wake time using getScheduleForDay(member, now).
 */
export function resolveActiveSleepCycle(
  member: Member,
  sleeperNow: DateTime,
  isInBed?: boolean
): {
  cycleEveningDate: string;
  targetBedtime: DateTime;
  targetWakeTime: DateTime;
  activeBedtimeLocal: string;
  activeWakeTimeLocal: string;
  isWeekendSchedule: boolean;
  isCustomScheduleToday: boolean;
  dayKey: DayKey;
  diffMinutes: number;
} {
  const effectiveInBed = isInBed !== undefined ? isInBed : Boolean(member.is_in_bed);

  // 1. Yesterday's cycle (initiated on sleeperNow.minus({ days: 1 }))
  const yesterdayNight = sleeperNow.minus({ days: 1 }).startOf('day');
  const yesterdayCycleDate = yesterdayNight.toISODate()!;
  const hasWokeUpForYesterday = Boolean(
    member.is_woke_up ||
    (member.last_wake_cycle_date && member.last_wake_cycle_date === yesterdayCycleDate)
  );
  const ySched = getNightScheduleDateTime(member, yesterdayNight);

  // Yesterday's active window starts when wind-down/curfew or early check-in begins (-180m before bedtime)
  const yStart = ySched.bedtimeDateTime.minus({ minutes: 180 });
  // Yesterday's window ends when yesterday's wake window has elapsed
  // If member is actively in bed without waking up, extend window up to 6 hours past wake time or 14 hours past bedtime
  // If member has not logged wake-up, keep yesterday's cycle active past wake time (up to 4 hours post-wake or until today's wind-down)
  const todayNightForWindDown = sleeperNow.startOf('day');
  const tSchedForWindDown = getNightScheduleDateTime(member, todayNightForWindDown);
  const todayWindDownStart = tSchedForWindDown.bedtimeDateTime.minus({ minutes: 180 });

  const postWakeWindow = ySched.wakeDateTime.plus({ hours: 4 });
  const inBedEnd = effectiveInBed && !hasWokeUpForYesterday
    ? todayWindDownStart
    : postWakeWindow;
  const maxYesterdayEnd = DateTime.max(postWakeWindow, inBedEnd);
  const yEnd = DateTime.min(maxYesterdayEnd, todayWindDownStart);

  if (sleeperNow >= yStart && sleeperNow < yEnd) {
    const diffMinutes = sleeperNow.diff(ySched.bedtimeDateTime, 'minutes').minutes;
    const mondaySched = getScheduleForDay(member, yesterdayNight.set({ weekday: 1 }));
    const isCustomScheduleToday =
      ySched.bedtimeStr !== mondaySched.bedtime || ySched.wakeTimeStr !== mondaySched.wake_time;

    return {
      cycleEveningDate: yesterdayNight.toISODate()!,
      targetBedtime: ySched.bedtimeDateTime,
      targetWakeTime: ySched.wakeDateTime,
      activeBedtimeLocal: ySched.bedtimeStr,
      activeWakeTimeLocal: ySched.wakeTimeStr,
      isWeekendSchedule: ySched.isWeekend,
      isCustomScheduleToday,
      dayKey: ySched.dayKey,
      diffMinutes,
    };
  }

  // 2. Today's cycle check second:
  const todayNight = sleeperNow.startOf('day');
  const tSched = getNightScheduleDateTime(member, todayNight);
  const diffMinutes = sleeperNow.diff(tSched.bedtimeDateTime, 'minutes').minutes;
  const mondaySched = getScheduleForDay(member, todayNight.set({ weekday: 1 }));
  const isCustomScheduleToday =
    tSched.bedtimeStr !== mondaySched.bedtime || tSched.wakeTimeStr !== mondaySched.wake_time;

  return {
    cycleEveningDate: todayNight.toISODate()!,
    targetBedtime: tSched.bedtimeDateTime,
    targetWakeTime: tSched.wakeDateTime,
    activeBedtimeLocal: tSched.bedtimeStr,
    activeWakeTimeLocal: tSched.wakeTimeStr,
    isWeekendSchedule: tSched.isWeekend,
    isCustomScheduleToday,
    dayKey: tSched.dayKey,
    diffMinutes,
  };
}

/**
 * Computes the canonical sleep cycle night date ("YYYY-MM-DD") for a member at a given moment.
 * Defined strictly by the local evening the sleep window begins.
 */
export function getSleepCycleDate(member: Member, nowUtc = DateTime.utc()): string {
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);
  const cycle = resolveActiveSleepCycle(member, sleeperNow);
  return cycle.cycleEveningDate;
}

/**
 * Checks whether the active sleep cycle (anchored strictly to the local evening) is a weekend night.
 * Weekend nights are explicitly defined as Friday nights and Saturday nights.
 */
export function isWeekendCycle(member: Member, nowUtc = DateTime.utc()): boolean {
  const cycleDateStr = getSleepCycleDate(member, nowUtc);
  const normalizedZone = toValidLuxonZone(member.timezone);
  const dt = DateTime.fromISO(cycleDateStr, { zone: normalizedZone });
  return dt.weekday === 5 || dt.weekday === 6;
}

/**
 * Converts a 24-hour 'HH:mm' time string into consistent 12-hour 'h:mm A' format.
 */
export function formatTime12h(timeStr: string | null | undefined): string {
  if (!timeStr) return '7:00 AM';
  const clean = timeStr.trim();
  if (/am|pm/i.test(clean)) return clean;
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return clean;
  const hours = parseInt(match[1], 10);
  const mins = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${h12}:${mins} ${period}`;
}

/**
 * Computes a member's sleep bucket, viewer-adjusted bedtime, and sleep shield state.
 * Fully DST-aware using Luxon's IANA timezone conversion engine.
 * Supports distinct 7-day variable sleep schedules and weekend hours.
 */
export function computeMemberState(
  member: Member,
  viewerTz: string,
  nowUtc = DateTime.utc(),
  isInBed?: boolean
): MemberState {
  // Validate timezone (supports strict IANA zones and GMT offsets)
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const normalizedViewerZone = toValidLuxonZone(viewerTz);

  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const targetViewerZone = DateTime.now().setZone(normalizedViewerZone).isValid
    ? normalizedViewerZone
    : 'UTC';

  const sleeperNow = nowUtc.setZone(sleeperZone);

  // Resolve the active sleep cycle (Yesterday's cycle checked first, then today's)
  const activeCycle = resolveActiveSleepCycle(member, sleeperNow, isInBed);

  const targetBedtime = activeCycle.targetBedtime;
  const isWeekendSchedule = activeCycle.isWeekendSchedule;
  const activeBedtimeLocal = activeCycle.activeBedtimeLocal;
  const activeWakeTimeLocal = activeCycle.activeWakeTimeLocal;
  const isCustomScheduleToday = activeCycle.isCustomScheduleToday;
  const dayKey = activeCycle.dayKey;
  const diffMinutes = activeCycle.diffMinutes;

  let bucket: SleepBucket = 'AWAKE';
  let status: SleepStatus = 'AWAKE';
  let statusText = '';
  let isSleepShieldActive = false;
  let checkedInEarly = false;
  let graceMinutesLeft = 0;
  let canVoteStrike = false;
  let needsWakeUpLog = false;

  const effectiveInBed = isInBed !== undefined ? isInBed : Boolean(member.is_in_bed);

  const hasLoggedWakeUp = Boolean(
    member.is_woke_up ||
    (member.last_wake_cycle_date && member.last_wake_cycle_date === activeCycle.cycleEveningDate)
  );

  const isPastWakeTime = sleeperNow >= activeCycle.targetWakeTime;

  // If member has checked in via "I'm in Bed" Safe Button
  // (Applies when within 3h before bedtime through 8h sleep window unless explicitly marked awake)
  if (effectiveInBed && !hasLoggedWakeUp && diffMinutes >= -180) {
    bucket = 'SLEEPING';
    status = 'SLEEPING';
    if (isPastWakeTime) {
      statusText = `In Bed • Past Wake Time (${activeWakeTimeLocal})`;
      isSleepShieldActive = false;
    } else {
      statusText = 'In Bed (Checked In) • Resting';
      isSleepShieldActive = true;
    }
    checkedInEarly = true;
    canVoteStrike = false;
    needsWakeUpLog = true;
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    // 1 to 60 minutes before bedtime: Winding down window
    bucket = 'WINDING_DOWN';
    status = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
    canVoteStrike = false;
    isSleepShieldActive = false;
    checkedInEarly = false;
    needsWakeUpLog = false;
  } else if (hasLoggedWakeUp) {
    // Explicitly marked awake / woke up from sleep
    bucket = 'AWAKE';
    status = 'AWAKE';
    statusText = 'Wide Awake • Rested';
    isSleepShieldActive = false;
    checkedInEarly = false;
    canVoteStrike = false;
    needsWakeUpLog = false;
  } else if (diffMinutes >= 0 && diffMinutes <= 5) {
    // 5-minute grace window: Strike voting is strictly locked
    bucket = 'BEDTIME_NOW';
    status = 'BEDTIME_GRACE';
    graceMinutesLeft = Math.max(1, Math.ceil(5 - diffMinutes));
    statusText = `Grace Period: ${graceMinutesLeft}m left`;
    canVoteStrike = false;
  } else if (diffMinutes > 5 && diffMinutes <= 60) {
    // Overdue within the immediate nag window: Strike voting unlocked
    bucket = 'BEDTIME_NOW';
    status = 'OVERDUE_NAG_NOW';
    statusText = `Bedtime hit ${Math.floor(diffMinutes)}m ago — Nag them!`;
    canVoteStrike = true;
  } else if (diffMinutes < 0 && diffMinutes >= -60) {
    bucket = 'WINDING_DOWN';
    status = 'WINDING_DOWN';
    statusText = `Bedtime in ${Math.abs(Math.floor(diffMinutes))}m`;
    canVoteStrike = false;
  } else if (diffMinutes > 60 && diffMinutes <= 480) {
    // Active sleep window (60m to 480m) without safe check-in:
    bucket = 'SLEEPING';
    status = 'OVERDUE_NAG_NOW';
    statusText = isPastWakeTime
      ? `Catching Z's • Past Wake Time (${activeWakeTimeLocal})`
      : `Catching Z's (Asleep)`;
    isSleepShieldActive = !isPastWakeTime;
    canVoteStrike = true;
    needsWakeUpLog = true;
  } else {
    bucket = 'AWAKE';
    status = 'AWAKE';
    canVoteStrike = false;
    if (effectiveInBed || (sleeperNow >= activeCycle.targetBedtime && sleeperNow < activeCycle.targetWakeTime.plus({ hours: 4 }))) {
      needsWakeUpLog = true;
    }
    // Find next upcoming bedtime strictly in the future
    const upcomingCandidates = [0, 1, 2, 3, 4, 5, 6]
      .map((offset) => {
        const nightDt = sleeperNow.plus({ days: offset }).startOf('day');
        return getNightScheduleDateTime(member, nightDt).bedtimeDateTime;
      })
      .filter((dt) => dt > sleeperNow)
      .sort((a, b) => a.toMillis() - b.toMillis());
    const nextBedtime = upcomingCandidates[0] || targetBedtime.plus({ days: 1 });
    const hoursUntil = Math.floor(nextBedtime.diff(sleeperNow, 'hours').hours);
    const minsUntil = Math.floor(nextBedtime.diff(sleeperNow, 'minutes').minutes % 60);
    statusText = `Awake • in ${hoursUntil}h ${minsUntil}m`;
  }

  // Convert bedtime to viewer's local time (DST-aware Luxon conversion)
  const viewerBedtime = targetBedtime.setZone(targetViewerZone);
  const formattedViewerTime = viewerBedtime.toFormat('h:mm a');
  const formattedSleeperTime = targetBedtime.toFormat('h:mm a');
  const formattedWakeTime = formatTime12h(activeWakeTimeLocal);

  // Cooldown notice calculation if pending
  let pendingNotice: string | null = null;
  if (
    member.pending_effective_at &&
    (member.pending_bedtime_local ||
      member.pending_weekend_bedtime_local ||
      member.pending_weekly_schedule)
  ) {
    const effectiveAt = DateTime.fromISO(member.pending_effective_at, { zone: 'utc' });
    const remainingHours = Math.max(0, Math.floor(effectiveAt.diff(nowUtc, 'hours').hours));
    const remainingMins = Math.max(0, Math.floor(effectiveAt.diff(nowUtc, 'minutes').minutes % 60));
    pendingNotice = `Schedule shifting in ${remainingHours}h ${remainingMins}m`;
  }

  const streakMilestone = member.streak_days ? getStreakMilestoneBadge(member.streak_days) : null;

  return {
    bucket,
    status,
    statusText,
    isSleepShieldActive,
    formattedViewerTime,
    formattedSleeperTime,
    formattedWakeTime,
    diffMinutes,
    graceMinutesLeft,
    canVoteStrike,
    pendingNotice,
    checkedInEarly,
    streakMilestone,
    isWeekendSchedule,
    isCustomScheduleToday,
    activeBedtimeLocal,
    activeWakeTimeLocal,
    dayKey,
    needsWakeUpLog,
    isPastWakeTime,
    hasLoggedWakeUp,
  };
}

/**
 * Returns the current calendar month in the member's local timezone (format: 'YYYY-MM', e.g. '2026-11').
 */
export function getCurrentStrikeMonth(member: Member, nowUtc = DateTime.utc()): string {
  const normalizedSleeperZone = toValidLuxonZone(member.timezone);
  const sleeperZone = DateTime.now().setZone(normalizedSleeperZone).isValid
    ? normalizedSleeperZone
    : 'UTC';
  const sleeperNow = nowUtc.setZone(sleeperZone);
  return sleeperNow.toFormat('yyyy-MM');
}

/**
 * Checks if a member's strike cycle month has rolled over to a new calendar month.
 * If so, lazily resets strikes_used and metastrikes_used to 0 (3 remaining each).
 */
export function checkMonthlyStrikeReset(
  member: Member,
  nowUtc = DateTime.utc()
): {
  reset: boolean;
  activeMember: Member;
} {
  const currentMonth = getCurrentStrikeMonth(member, nowUtc);
  const cycleMonth = member.strike_cycle_month || currentMonth;

  if (cycleMonth !== currentMonth) {
    const updated: Member = {
      ...member,
      strikes_used: 0,
      metastrikes_used: 0,
      strike_cycle_month: currentMonth,
    };
    return { reset: true, activeMember: updated };
  }

  return { reset: false, activeMember: member };
}
