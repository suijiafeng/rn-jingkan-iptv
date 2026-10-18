import { splitGroups, UNGROUPED } from "./channelLabels";
import type { Channel } from "./types";
import { ISO639_3_NAMES, ISO639_3_ONLY, ISO639_3_TO_1 } from "./iso639";
import { COUNTRY_NAMES_ZH, LANGUAGE_NAMES_ZH } from "./displayNamesZh";

export type FacetKind = "country" | "language" | "content";
export interface ChannelFacetSelection {
  country: string | null;
  language: string | null;
  content: string | null;
}
export interface ChannelFacetOptions {
  countries: string[];
  languages: string[];
  contents: string[];
}
export const EMPTY_FACETS: ChannelFacetSelection = {
  country: null,
  language: null,
  content: null,
};
export const EMPTY_FACET_OPTIONS: ChannelFacetOptions = {
  countries: [],
  languages: [],
  contents: [],
};

// Assigned ISO 3166-1 alpha-2 codes, including territories, plus XK (Kosovo,
// the widely used user-assigned code that iptv-org also uses). Never infer these
// from a channel title, URL or a device's location; the only tvg-id source is
// the strict iptv-org format below.
const COUNTRY_CODES = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(
    " ",
  ),
);
const COUNTRY_FALLBACK: Record<string, string> = {
  CN: "中国大陆",
  HK: "中国香港",
  MO: "中国澳门",
  TW: "中国台湾",
  US: "美国",
  GB: "英国",
  JP: "日本",
  KR: "韩国",
  KP: "朝鲜",
  SG: "新加坡",
  MY: "马来西亚",
  TH: "泰国",
  VN: "越南",
  IN: "印度",
  ID: "印度尼西亚",
  AU: "澳大利亚",
  NZ: "新西兰",
  CA: "加拿大",
  DE: "德国",
  FR: "法国",
  ES: "西班牙",
  IT: "意大利",
  RU: "俄罗斯",
  BR: "巴西",
  MX: "墨西哥",
  UA: "乌克兰",
  PH: "菲律宾",
  TR: "土耳其",
  ZA: "南非",
  AE: "阿联酋",
};
const COUNTRY_ALIASES: Record<string, string> = {
  china: "CN",
  "people's republic of china": "CN",
  中国大陆: "CN",
  中华人民共和国: "CN",
  "hong kong": "HK",
  香港: "HK",
  macau: "MO",
  macao: "MO",
  澳门: "MO",
  taiwan: "TW",
  台湾: "TW",
  usa: "US",
  "united states": "US",
  "united states of america": "US",
  uk: "GB",
  "united kingdom": "GB",
  britain: "GB",
  england: "GB",
  "south korea": "KR",
  "republic of korea": "KR",
  "north korea": "KP",
  russia: "RU",
  "czech republic": "CZ",
  turkey: "TR",
  "viet nam": "VN",
};
const LANGUAGE_CODES = new Set(
  "aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(
    " ",
  ),
);
const LANGUAGE_ALIASES: Record<string, string> = {
  chinese: "zh",
  中文: "zh",
  汉语: "zh",
  普通话: "zh",
  mandarin: "zh",
  cantonese: "yue",
  粤语: "yue",
  english: "en",
  英语: "en",
  japanese: "ja",
  日语: "ja",
  korean: "ko",
  韩语: "ko",
  french: "fr",
  法语: "fr",
  german: "de",
  德语: "de",
  spanish: "es",
  西班牙语: "es",
  russian: "ru",
  俄语: "ru",
  arabic: "ar",
  阿拉伯语: "ar",
  portuguese: "pt",
  葡萄牙语: "pt",
  hindi: "hi",
  印地语: "hi",
  indonesian: "id",
  malay: "ms",
  thai: "th",
  vietnamese: "vi",
  eng: "en",
  zho: "zh",
  chi: "zh",
  cmn: "zh",
  jpn: "ja",
  kor: "ko",
  fra: "fr",
  fre: "fr",
  deu: "de",
  ger: "de",
  spa: "es",
  rus: "ru",
  ara: "ar",
  por: "pt",
  hin: "hi",
  ind: "id",
  msa: "ms",
  may: "ms",
  tha: "th",
  vie: "vi",
  ita: "it",
  nld: "nl",
  dut: "nl",
  tur: "tr",
  ukr: "uk",
  pol: "pl",
  ces: "cs",
  cze: "cs",
  ell: "el",
  gre: "el",
  heb: "he",
  iw: "he",
  in: "id",
  ji: "yi",
  ron: "ro",
  rum: "ro",
  fas: "fa",
  per: "fa",
  ben: "bn",
  tam: "ta",
  tel: "te",
  urd: "ur",
};
const LANGUAGE_FALLBACK: Record<string, string> = {
  zh: "中文",
  yue: "粤语",
  en: "英语",
  ja: "日语",
  ko: "韩语",
  fr: "法语",
  de: "德语",
  es: "西班牙语",
  ru: "俄语",
  ar: "阿拉伯语",
  pt: "葡萄牙语",
  hi: "印地语",
  id: "印度尼西亚语",
  ms: "马来语",
  th: "泰语",
  vi: "越南语",
};
// Common languages without a two-letter code remain useful when the runtime
// has no DisplayNames data. Other known three-letter codes use its registry.
const THREE_LETTER_LANGUAGES = new Set(
  "ace ast bho ceb chr doi fil gsw hak haw hmn kok mai nan pap sah sat sco syr tet tok wuu yue".split(
    " ",
  ),
);
const knownLanguages = new Map<string, boolean>();

function displayName(
  type: "region" | "language",
  value: string,
): string | undefined {
  try {
    if (typeof Intl.DisplayNames !== "function") return undefined;
    return new Intl.DisplayNames(["zh-Hans"], { type, fallback: "none" }).of(
      value,
    );
  } catch {
    return undefined;
  }
}

export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && COUNTRY_CODES.has(value);
}

let countryNames: Map<string, string> | undefined;
function namedCountry(value: string): string | undefined {
  if (!countryNames) {
    countryNames = new Map(Object.entries(COUNTRY_ALIASES));
    for (const code of COUNTRY_CODES) {
      const names = [
        COUNTRY_NAMES_ZH[code],
        COUNTRY_FALLBACK[code],
        displayName("region", code),
      ];
      try {
        if (typeof Intl.DisplayNames === "function")
          names.push(
            new Intl.DisplayNames(["en"], {
              type: "region",
              fallback: "none",
            }).of(code),
          );
      } catch {
        /* Name lookup is optional; ISO codes still work offline. */
      }
      for (const name of names)
        if (name) countryNames.set(name.toLowerCase(), code);
    }
  }
  return countryNames.get(value.toLowerCase());
}

/** Bound metadata and keep safe, whole tokens for SQLite's semicolon format. */
function normalizeList(
  raw: string | null | undefined,
  normalize: (part: string) => string | undefined,
): string[] {
  const values = new Set<string>();
  for (const part of (raw ?? "").slice(0, 2048).split(/[;,；，|/]+/)) {
    const value = normalize(part.trim());
    if (value) values.add(value);
    if (values.size >= 16) break;
  }
  return [...values];
}

// iptv-org channel ids: "<Name>.<country>@<feed>", e.g. "CCTV1.cn@SD".
// The suffix is that database's country field (verified identical for all
// 11,356 entries of its full index); "uk" is its code for GB.
const IPTV_ORG_ID = /^[A-Za-z0-9][A-Za-z0-9-]*\.([a-z]{2})(?:@[A-Za-z0-9-]+)?$/;

/** True when a tvg-id follows the iptv-org database format. */
export function isIptvOrgId(tvgId: string | null | undefined): boolean {
  return !!tvgId && IPTV_ORG_ID.test(tvgId);
}

/**
 * Country from an iptv-org formatted tvg-id only. Any other id format yields
 * nothing: titles, URLs and free-form ids are never guessed from.
 */
export function countryFromIptvOrgId(
  tvgId: string | null | undefined,
): string[] {
  const match = tvgId ? IPTV_ORG_ID.exec(tvgId) : null;
  if (!match) return [];
  const code = match[1] === "uk" ? "GB" : match[1].toUpperCase();
  return isCountryCode(code) ? [code] : [];
}

export function normalizeCountries(raw: string | null | undefined): string[] {
  return normalizeList(raw, (part) => {
    const code = part.toUpperCase();
    return isCountryCode(code) ? code : namedCountry(part);
  });
}

function normalizeLanguage(part: string): string | undefined {
  const lower = part.toLowerCase().replace(/_/g, "-");
  if (LANGUAGE_ALIASES[lower]) return LANGUAGE_ALIASES[lower];
  // iptv-org uses ISO 639-3 ("zho", "spa"); store the two-letter form.
  if (ISO639_3_TO_1[lower]) return ISO639_3_TO_1[lower];
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,4}$/.test(lower)) return undefined;
  const [original, ...subtags] = lower.split("-");
  const base = LANGUAGE_ALIASES[original] ?? original;
  if (["und", "mul", "zxx"].includes(base)) return undefined;
  let known = knownLanguages.get(base);
  if (known === undefined) {
    const name = displayName("language", base);
    known =
      LANGUAGE_CODES.has(base) ||
      THREE_LETTER_LANGUAGES.has(base) ||
      ISO639_3_ONLY.has(base) ||
      (!!name && name !== base);
    knownLanguages.set(base, known);
  }
  if (!known) return undefined;
  // A region/script/variant must be an explicit, valid BCP 47 subtag.
  let index = 0;
  const normalized: string[] = [base];
  if (/^[a-z]{4}$/.test(subtags[index] ?? "")) {
    const script = subtags[index++];
    normalized.push(script[0].toUpperCase() + script.slice(1));
  }
  if (/^(?:[a-z]{2}|[0-9]{3})$/.test(subtags[index] ?? "")) {
    const region = subtags[index++].toUpperCase();
    if (!/^[0-9]{3}$/.test(region) && !isCountryCode(region)) return undefined;
    normalized.push(region);
  }
  for (; index < subtags.length; index += 1) {
    const variant = subtags[index];
    if (!/^(?:[a-z0-9]{5,8}|[0-9][a-z0-9]{3})$/.test(variant)) return undefined;
    normalized.push(variant);
  }
  const tag = normalized.join("-");
  try {
    return typeof Intl.getCanonicalLocales === "function"
      ? Intl.getCanonicalLocales(tag)[0]
      : tag;
  } catch {
    return undefined;
  }
}

export function normalizeLanguages(raw: string | null | undefined): string[] {
  return normalizeList(raw, normalizeLanguage);
}

export function countryLabel(value: string): string {
  return !value
    ? "未标注"
    : (COUNTRY_NAMES_ZH[value] ??
        displayName("region", value) ??
        COUNTRY_FALLBACK[value] ??
        value);
}
export function languageLabel(value: string): string {
  if (!value) return "未标注";
  // Static names first: Hermes has no Intl.DisplayNames data on Android.
  return (
    LANGUAGE_NAMES_ZH[value] ??
    LANGUAGE_NAMES_ZH[value.split("-")[0]] ??
    displayName("language", value) ??
    LANGUAGE_FALLBACK[value] ??
    ISO639_3_NAMES[value] ??
    value
  );
}
export function facetLabel(kind: FacetKind, value: string | null): string {
  if (value === null) return "全部";
  if (!value || (kind === "content" && value === UNGROUPED)) return "未标注";
  return kind === "country"
    ? countryLabel(value)
    : kind === "language"
      ? languageLabel(value)
      : value;
}

type FacetChannel = Pick<Channel, "countries" | "languages" | "groupName">;
function contentValues(channel: FacetChannel): string[] {
  return splitGroups(channel.groupName).map((value) =>
    value === UNGROUPED ? "" : value,
  );
}
const facetOrder = new Intl.Collator("zh-Hans-CN");
// Pinned to the top of long menus (200+ languages, 160+ countries), in
// this order; everything else follows by Chinese collation, unlabeled last.
const PINNED: Partial<Record<FacetKind, readonly string[]>> = {
  // 通行写法与顺序：中国大陆、中国香港、中国澳门、中国台湾。
  country: ["CN", "HK", "MO", "TW"],
  language: ["zh", "yue", "en"],
};
function sortOptions(values: Set<string>, kind: FacetKind): string[] {
  const pinned = PINNED[kind] ?? [];
  const rank = (value: string) => {
    const index = pinned.indexOf(value);
    return index >= 0 ? index : pinned.length;
  };
  return [...values].sort((a, b) =>
    !a
      ? !b
        ? 0
        : 1
      : !b
        ? -1
        : rank(a) - rank(b) ||
          facetOrder.compare(facetLabel(kind, a), facetLabel(kind, b)),
  );
}
export function buildFacetOptions(
  channels: readonly FacetChannel[],
): ChannelFacetOptions {
  const countries = new Set<string>();
  const languages = new Set<string>();
  const contents = new Set<string>();
  for (const channel of channels) {
    const countryValues = normalizeCountries(channel.countries?.join(";"));
    const languageValues = normalizeLanguages(channel.languages?.join(";"));
    for (const value of countryValues.length ? countryValues : [""])
      countries.add(value);
    for (const value of languageValues.length ? languageValues : [""])
      languages.add(value);
    for (const value of contentValues(channel)) contents.add(value);
  }
  return {
    countries: sortOptions(countries, "country"),
    languages: sortOptions(languages, "language"),
    contents: sortOptions(contents, "content"),
  };
}
export function matchesChannelFacets(
  channel: FacetChannel,
  selection: ChannelFacetSelection,
): boolean {
  const countries = normalizeCountries(channel.countries?.join(";"));
  const languages = normalizeLanguages(channel.languages?.join(";"));
  const matches = (values: string[], value: string | null) =>
    value === null || (value === "" ? !values.length : values.includes(value));
  return (
    matches(countries, selection.country) &&
    matches(languages, selection.language) &&
    (selection.content === null ||
      contentValues(channel).includes(
        selection.content === UNGROUPED ? "" : selection.content,
      ))
  );
}
