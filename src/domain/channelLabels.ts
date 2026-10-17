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

export function displayGroups(groupName: string): string {
  return splitGroups(groupName).join("、");
}

const TAG_TRANSLATIONS: Record<string, string> = {
  "geo-blocked": "地区限制",
  "not 24/7": "非全天",
};

/**
 * Splits trailing "[Geo-blocked]" / "[Not 24/7]" style markers off a channel
 * name for display. The stored name is unchanged, so search still matches.
 */
export function channelTitle(name: string): { title: string; tags: string[] } {
  const tags: string[] = [];
  let title = name.trim();
  let match: RegExpMatchArray | null;
  while ((match = title.match(/\s*\[([^\]\n]{1,40})\]$/))) {
    const tag = match[1].trim();
    tags.unshift(TAG_TRANSLATIONS[tag.toLowerCase()] ?? tag);
    title = title.slice(0, title.length - match[0].length).trim();
  }
  // A name made only of brackets is the name itself, not markers.
  return title ? { title, tags } : { title: name.trim(), tags: [] };
}
