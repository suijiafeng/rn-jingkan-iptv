import { countryLabel, isCountryCode } from "../../domain/channelFacets";

export interface CountryPreference {
  mode: "auto" | "manual";
  countryCode: string | null;
  ipAllowed: boolean;
  locationAllowed: boolean;
}

export interface RegionResult {
  countryCode: string | null;
  source: "location" | "ip" | "device" | "conflict" | "none";
  /** What the result rests on: one short line for the country menu. */
  message: string;
}

export interface DeviceEvidence {
  region: string | null;
  language: string | null;
  timeZone: string | null;
}

export const DEFAULT_COUNTRY_PREFERENCE: CountryPreference = {
  mode: "auto",
  countryCode: null,
  ipAllowed: false,
  locationAllowed: false,
};

export const NO_REGION: RegionResult = {
  countryCode: null,
  source: "none",
  message: "地区信息不足",
};

// Single-country zones from IANA zone1970.tab (2026-10-18), with backward aliases
// resolved first. Even named zones such as Tokyo, Singapore and Bangkok cover
// multiple territories in that dataset and deliberately yield no evidence.
// These are configuration hints, never coordinates or inferred UTC offsets.
const TIME_ZONE_COUNTRIES: Record<string, string> = {
  "Asia/Shanghai": "CN",
  "Asia/Chongqing": "CN",
  "Asia/Harbin": "CN",
  "Asia/Urumqi": "CN",
  "Asia/Kashgar": "CN",
  "Asia/Hong_Kong": "HK",
  "Asia/Macau": "MO",
  "Asia/Macao": "MO",
  "Asia/Taipei": "TW",
  "Asia/Seoul": "KR",
  "Asia/Pyongyang": "KP",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Asia/Ho_Chi_Minh": "VN",
  "Asia/Saigon": "VN",
  "Asia/Jakarta": "ID",
  "Asia/Makassar": "ID",
  "Asia/Jayapura": "ID",
  "Asia/Manila": "PH",
  "Asia/Jerusalem": "IL",
  "Asia/Karachi": "PK",
  "Asia/Dhaka": "BD",
  "Asia/Kathmandu": "NP",
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Lisbon": "PT",
  "Atlantic/Azores": "PT",
  "Europe/Dublin": "IE",
  "Europe/Moscow": "RU",
  "Asia/Vladivostok": "RU",
  "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA",
  "Europe/Warsaw": "PL",
  "Europe/Athens": "GR",
  "Europe/Vienna": "AT",
  "Europe/Istanbul": "TR",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "America/Vancouver": "CA",
  "America/Winnipeg": "CA",
  "America/Halifax": "CA",
  "America/St_Johns": "CA",
  "America/Mexico_City": "MX",
  "America/Sao_Paulo": "BR",
  "America/Bogota": "CO",
  "America/Argentina/Buenos_Aires": "AR",
  "America/Santiago": "CL",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Australia/Adelaide": "AU",
  "Australia/Darwin": "AU",
  "Australia/Hobart": "AU",
  "Pacific/Chatham": "NZ",
  "Africa/Cairo": "EG",
  "Africa/Casablanca": "MA",
};

export function timeZoneCountry(timeZone: string | null): string | null {
  return timeZone ? (TIME_ZONE_COUNTRIES[timeZone] ?? null) : null;
}

export function parseCountryPreference(value: unknown): CountryPreference {
  if (!value || typeof value !== "object")
    return { ...DEFAULT_COUNTRY_PREFERENCE };
  const input = value as Record<string, unknown>;
  const mode = input.mode === "manual" ? "manual" : "auto";
  const countryCode = isCountryCode(input.countryCode)
    ? input.countryCode
    : mode === "manual" && input.countryCode === ""
      ? ""
      : null;
  return {
    mode,
    countryCode,
    ipAllowed: input.ipAllowed === true,
    locationAllowed: input.locationAllowed === true,
  };
}

export function resolveRegion(
  device: DeviceEvidence,
  ipCountry: string | null = null,
  locationCountry: string | null = null,
): RegionResult {
  const location = isCountryCode(locationCountry) ? locationCountry : null;
  const ip = isCountryCode(ipCountry) ? ipCountry : null;
  const region = isCountryCode(device.region) ? device.region : null;
  const zone = timeZoneCountry(device.timeZone);
  if (location && ip && location !== ip)
    return {
      countryCode: null,
      source: "conflict",
      message: "手机位置与访问 IP 不一致",
    };
  if (location)
    return {
      countryCode: location,
      source: "location",
      message: `依据：手机位置${ip ? "、访问 IP" : ""}`,
    };
  if (ip) {
    // Language is deliberately not a location vote. A Chinese UI does not
    // establish China, and device region/time zone are correlated settings.
    if ((region && region !== ip) || (zone && zone !== ip))
      return {
        countryCode: null,
        source: "conflict",
        message: "IP 与手机地区或时区不一致",
      };
    if (region === ip || zone === ip)
      return {
        countryCode: ip,
        source: "ip",
        message: "依据：访问 IP、手机地区或时区",
      };
    return {
      ...NO_REGION,
      message: "访问 IP 缺少手机设置印证",
    };
  }
  if (region && zone === region)
    return {
      countryCode: region,
      source: "device",
      message: "依据：手机地区与时区设置",
    };
  if (region && zone && region !== zone)
    return {
      countryCode: null,
      source: "conflict",
      message: "手机地区与时区不一致",
    };
  return { ...NO_REGION };
}

export function effectiveCountry(
  preference: CountryPreference,
  result: RegionResult,
  availableCountries: readonly string[],
): string | null {
  if (preference.mode === "manual") return preference.countryCode;
  return result.countryCode && availableCountries.includes(result.countryCode)
    ? result.countryCode
    : null;
}

/**
 * The one small line at the top of the country menu: what the shown country
 * rests on. The main screen shows only the result itself.
 */
export function regionBasis(
  preference: CountryPreference,
  result: RegionResult,
  shownCountry: string | null,
): string {
  if (preference.mode === "manual") return "手动选择";
  if (result.countryCode && shownCountry === null)
    return `识别为${countryLabel(result.countryCode)}，来源中无此标注`;
  return result.message;
}
