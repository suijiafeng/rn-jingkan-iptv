import { parseDeclaredQuality } from "./channelSources";
/** Groups are stored as a ";"-joined, translated, de-duplicated list. */
export const UNGROUPED = "未分组";
export const GROUP_SEPARATOR = ";";

// iptv-org category vocabulary (https://github.com/iptv-org/database).
const GROUP_TRANSLATIONS: Record<string, string> = {
  animation: "动画",
  auto: "汽车",
  business: "财经",
  classic: "经典",
  comedy: "喜剧",
  cooking: "美食",
  culture: "文化",
  documentary: "纪录片",
  education: "教育",
  entertainment: "娱乐",
  family: "家庭",
  general: "综合",
  interactive: "互动",
  kids: "少儿",
  legislative: "议会",
  lifestyle: "生活",
  movies: "电影",
  music: "音乐",
  news: "新闻",
  outdoor: "户外",
  public: "公共",
  relax: "休闲",
  religious: "宗教",
  science: "科学",
  series: "剧集",
  shop: "购物",
  sports: "体育",
  travel: "旅游",
  weather: "天气",
};
const NO_GROUP = new Set(["", "undefined", "other", "others", "未分组"]);

/** "Culture;Documentary;Travel" → "文化;纪录片;旅游"; empty/Undefined → 未分组. */
export function normalizeGroups(raw: string | undefined | null): string {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[;；]/)) {
    const trimmed = part.trim();
    if (NO_GROUP.has(trimmed.toLowerCase())) continue;
    seen.add(GROUP_TRANSLATIONS[trimmed.toLowerCase()] ?? trimmed);
  }
  return seen.size ? [...seen].join(GROUP_SEPARATOR) : UNGROUPED;
}

export function splitGroups(groupName: string): string[] {
  const parts = groupName
    .split(GROUP_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [UNGROUPED];
}

/**
 * The row's group caption. `hidden` is the group the list is already
 * filtered to: repeating it on every row says nothing, so only the
 * channel's other groups remain (possibly none).
 */
export function displayGroups(
  groupName: string,
  hidden: string | null = null,
): string {
  return splitGroups(groupName)
    .filter((group) => group !== hidden)
    .join("、");
}

/**
 * The group every listed row shares, if any: the content tab chosen on the
 * "all" scope ("" selects ungrouped channels). Other scopes ignore it.
 */
export function filteredGroup(
  scope: string,
  content: string | null,
): string | null {
  if (scope !== "all" || content === null) return null;
  return content || UNGROUPED;
}

/**
 * Up to three characters that tell channels of one family apart in a list:
 * "CCTV5+" → "5+", "CCTV怀旧剧场" → "怀", "CGTN" → "CG", "湖南卫视" → "湖".
 * A shared Latin prefix (CCTV, BTV…) would otherwise give every row the same
 * first letter.
 */
export function channelMonogram(title: string): string {
  const name = title.trim();
  const prefixed = name.match(/^[A-Za-z]{2,}[\s-]*(.*)$/);
  if (prefixed) {
    const rest = prefixed[1];
    const number = rest.match(/^\d{1,2}\+?/);
    if (number) return number[0];
    const first = Array.from(rest)[0];
    if (first && first.charCodeAt(0) > 0x7f) return first;
    return name.slice(0, 2).toUpperCase();
  }
  return Array.from(name)[0] || "台";
}

const TAG_TRANSLATIONS: Record<string, string> = {
  "geo-blocked": "地区限制",
  "not 24/7": "非全天",
};

/**
 * Splits trailing "[Geo-blocked]" / "[Not 24/7]" style markers, and a
 * quality written in parentheses ("(1080p)", "（HD）"), off a channel name
 * for display. The stored name is unchanged, so search still matches, and
 * nothing here feeds identity or the source's declared quality.
 */
export function channelTitle(name: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  let title = name.trim();
  let match: RegExpMatchArray | null;
  for (;;) {
    if ((match = title.match(/\s*\[([^\]\n]{1,40})\]$/))) {
      const tag = match[1].trim();
      tags.unshift(TAG_TRANSLATIONS[tag.toLowerCase()] ?? tag);
    } else if ((match = title.match(/\s*[(（]([^)）\n]{1,10})[)）]$/))) {
      // Only a recognisable quality: "(Beijing)" stays part of the name.
      const quality = parseDeclaredQuality(match[1]);
      if (!quality) break;
      tags.unshift(quality.label);
    } else break;
    title = title.slice(0, title.length - match[0].length).trim();
  }
  // A name made only of brackets is the name itself, not markers.
  return title ? { title, tags } : { title: name.trim(), tags: [] };
}
